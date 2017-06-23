"use strict";
const path = require("path");
const hasha = require("hasha");
const fileHandler = require("./lib/fileHandler");
const attachListeners = require("./lib/attachListeners");

const ExpressFormPost = function(user_options = {}) {
	if(!(this instanceof ExpressFormPost)) return new ExpressFormPost(user_options);

	// validateFile
	if(user_options.validateFile) {
		if(typeof user_options.validateFile != "function") throw new Error("option 'validateFile' must be a function.");
	} else {
		user_options.validateFile = (handlePromise) => handlePromise();
	}

	/*
	 * validateBody validates the req.body before sending off files to the store
	 * if validateBody is set in any way, the file buffers will be sent to the store after the request has been validated
	 * This means that file_contents.end() only triggers after the "end" event is emitted
	 */
	if(user_options.validateBody) {
		if(typeof user_options.validateBody != "function") {
			throw new Error("option validateBody must be a function.");
		}
	} else {
		user_options.validateBody = (handlePromise) => handlePromise();
	}

	// max file size
	if(user_options.maxfileSize) {
		if(!Number.isInteger(user_options.maxfileSize)) {
			throw new Error("option 'maxfileSize' must be an integer (Measured in bytes).");
		}
	}

	// Available storage methods
	if(!["disk", "aws-s3", "dropbox"].includes(user_options.store)) {
		if(user_options.store == undefined) {
			user_options.store = "disk";
		} else {
			throw new Error("storage " + user_options.store + " is not supported by express-form-post.\n"
				+ "\tCurrently available: ['disk', 'aws-s3', 'dropbox']");
		}
	}

	// Setting default directory based on store
	user_options.directory == undefined ? user_options.store == "disk" ? (
		user_options.directory = path.join(module.parent.filename, "..")
	) : user_options.directory = "" : "";

	// filename options setup
	if(typeof user_options.filename == "function") {
		let customFileMethod = user_options.filename;
		user_options.filename = function(originalname, fieldname, mimetype) {
			let customName = customFileMethod(originalname, fieldname, mimetype);
			if(customName == undefined || customName == "") {
				return originalname; // returning the original name that is being uploaded
			} 
			return customName;
		};
		
	} else {
		switch(user_options.filename) {
		case undefined:
		case "": 
			user_options.filename = (originalname) => { return hasha(originalname); };
			break;
		default:
			var user_input = user_options.filename; // Closures are awesome
			user_options.filename = () => { return user_input; };
		}
	}

	this.options = {
		store: user_options.store,
		directory: user_options.directory,
		filename: user_options.filename,
		maxfileSize: user_options.maxfileSize,
		minfileSize: user_options.minfileSize || 0,
		validateFile: user_options.validateFile,
		validateBody: user_options.validateBody,
		api: user_options.api
	};

	this.storeMethod = require(path.join(__dirname, "lib/store", this.options.store));

	// set up abi objects here so we won't have to recreate upon sending buffer to store handler
	switch(this.options.store){
	case "aws-s3":{
		let aws = require("aws-sdk");
		aws.config.update({
			accessKeyId: this.options.api.accessKeyId,
			secretAccessKey: this.options.api.secretAccessKey,
		});
		this.apiObject = new aws.S3();
		break;
	}
	case "dropbox":{
		let Dropbox = require("dropbox");	
		this.apiObject = new Dropbox({
			accessToken: this.options.api.accessToken,
			clientId: this.options.api.clientId,
			selectUser: this.options.api.selectUser,
		});
		break;
	}
	default:
		this.apiObject = {}; // apiObject does not init on disk
	}
};

ExpressFormPost.prototype._fileHandler = fileHandler;
ExpressFormPost.prototype._attachListeners = attachListeners;

ExpressFormPost.prototype.fields = function() {
	return require("./lib/fields").bind(this);
};

ExpressFormPost.prototype.middleware = function(handleError = undefined) {
	this.middleware.handleError = handleError; // the function to be called inside handleError
	this.handleError = () => {}; // empty anon function to be reassigned in fileHandler
	/*
	 * fileHandler will be called in app.use as (req, res, cb)
	 * binding this to the return value because when it is used in the express middleware _filehandler loses this context
	 * the value of _fileHandler the function is being used to call rather than the function itself
	 */
	return this._fileHandler.bind(this);
};

// Upload function to be used within routes. handleError set as callback as well and can be check with if (err)
ExpressFormPost.prototype.upload = function(req, res, cb = () => {}) {
	typeof cb == "function" ? "" : cb = () => {}; // prevent user failure
	// reassign in fileHandler
	this.handleError = undefined;
	// cb is cb in fileHandler param
	this._fileHandler(req, res, cb);
};


module.exports = ExpressFormPost;