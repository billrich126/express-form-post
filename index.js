"use strict";
const path = require("path");
const Busboy = require("busboy");
const farmhash = require('farmhash');

const ExpressFormPost = function(user_options = {}) {
	if(!(this instanceof ExpressFormPost)) return new ExpressFormPost(user_options);

	// validate
	if(user_options.validate) {
		if(typeof user_options.validate != "function") throw new Error("option 'validate' must be a function.");
	} else {
		user_options.validate = function() { return true; };
	}

	// max file size
	if(user_options.maxfileSize) {
		if(!Number.isInteger(user_options.maxfileSize)) {
			throw new Error("option 'maxfileSize' must be an integer (Measured in bytes).");
		}
	}

	// Available storage methods
	if(!["disk", "aws-s3", "google-drive"].includes(user_options.store)) {
		if(user_options.store == undefined) {
			user_options.store = "disk";
		} else {
			throw new Error("storage " + user_options.store + " is not supported by express-form-post");
		}
	}

	// Setting default directory based on store
	user_options.directory == undefined ? user_options.store == "disk" ? (
		user_options.directory = path.join(module.parent.filename, "..")
	) : user_options.directory = "" : "";

	// filename options setup
	if(typeof user_options.filename == "function") {
		let customFileMethod = user_options.filename;
		user_options.filename = function(filename, fieldname, mimetype) {
			let customName = customFileMethod(filename, fieldname, mimetype);
			if(customName == undefined || customName == "") {
				return filename; // returning the filename that is being uploaded
			} 
			return customName;
		};
		
	} else {
		switch(user_options.filename) {
		case undefined:
		case "": 
			user_options.filename = function(filename) {
				return farmhash.hash64(filename);
			};
			break;
		default:
			var user_input = user_options.filename; // Closures are awesome
			user_options.filename = function() {
				return user_input;
			};
		}
	}

	this.options = {
		store: user_options.store,
		directory: user_options.directory,
		filename: user_options.filename,
		maxfileSize: user_options.maxfileSize,
		validate: user_options.validate,
		keys: user_options.keys
	};

};

const storeInMemory = function(busboy, req) {

	busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
		if(!req.efp._validate || this.options.validate(fieldname, mimetype) == false) {
			req.efp._validate == true ? (
				req.efp._validate = false,
				this.handleError(new Error("Validation error by custom validate function"))
			) : "";
			return;
		}

		// user may use filename function but incorrectly return nothing. no warning supplied. defaults to hash 32 bit
		let save_filename = this.options.filename(filename, fieldname, mimetype) || farmhash.hash64(filename);
		save_filename.includes("/") ? (
			this.options.directory = path.join(this.options.directory, save_filename, ".."),
			save_filename = path.basename(path.resolve(...(save_filename.split("/"))))
		): "";

		let uploadInfo = {
			directory: this.options.directory,
			filename: save_filename,
			mimetype: mimetype,
			fieldname: fieldname,
			file: file,
			encoding: encoding,
			keys: this.options.keys
		};

		// init concat-stream
		const storeMethod = require(path.join(__dirname, "lib", this.options.store));
		const file_contents = storeMethod(uploadInfo, req, this.finished, this.handleError);

		file.on("data", (data) => {
			if (!req.files[fieldname]) {
				req.files[fieldname] = {}; 
			}
			file_contents.write(data);
		});
		file.on("limit", () => {
			this.handleError(new Error("File limit reached on file"));
		});
		file.on("end", () => {
			if (!file.truncated && req.files[fieldname]) {
				req._files++; // increment count of files being uploaded to store
				file_contents.end();
			}
		});
	});

	busboy.on("field", (fieldname, val, fieldnameTruncated, valTruncated, mimetype) => {
		// Possibly should add some handler for if a certain value was truncated
		req.efp._validate && !valTruncated && !fieldnameTruncated ? req.body[fieldname] = val : "";
	});
	busboy.on("finish", () => {
		if(req._files == 0) {
			// no file was uploaded
			return this.finished();
		}
	});
};

// Default
const fileHandler = function(req, res, cb) {
	if(req.method == "POST") {
		/* 
		 * In middleware, this.finished passes on to next middleware
		 * In upload function, this.finished will be the callback with an err parameter. (Can be undefined)
		 * This.finished will be called when finished with parsing the request to pass on to the cb action
		 */
		req.efp = {};
		req.body = {};
		req.files = {};
		req._files = 0;
		req.efp._validate = true; // value of true means request is a valid request by the validate function
		this.next = cb; // for middleware usage
		this.finished = function(err) {
			if(req.efp._finished) return;
			req.efp._finished = true;
			if(err) return cb(err);
			return cb();
		}
		this.handleError ? this.handleError : this.handleError = this.finished;

		if(req._body) {
			return this.finished();
		}
		let busboy = new Busboy({ 
			headers: req.headers,
			limits: {
				fileSize: this.options.maxfileSize
			}
		});
		storeInMemory.bind(this)(busboy, req);
		req.pipe(busboy);
	} else {
		return cb();
	}
};

ExpressFormPost.prototype.middleware = function(handleError = undefined) {
	typeof handleError == "function" ? (
		this.handleError = (err) => { !req.efp._finished ? ( 
			req.efp._finished = true, 
			handleError(), 
			this.next()
		) : ""; } 
	) : this.handleError = () => { !req.efp._finished ? (
			req.efp._finished = true, 
			this.next() 
		): ""; };

	return fileHandler.bind(this); // fileHandler will be called in app.use as (req, res, cb)
};

// Upload function to be used within routes. handleError set as callback as well and can be check with if (err)
ExpressFormPost.prototype.upload = function(req, res, cb) {
	// reassign in fileHandler
	this.handleError = undefined; 
	// cb is cb in fileHandler param
	fileHandler.bind(this)(req, res, cb);
}


module.exports = ExpressFormPost;