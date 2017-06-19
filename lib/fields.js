const Busboy = require("busboy");

module.exports = function(req, res, next) {
	if(req.method == "POST" && req.headers["content-type"].includes("multipart")) {
		var busboy = new Busboy({ headers: req.headers });

		req.body = {};

		busboy.on("file", (fieldname, file, originalname, encoding, mimetype) => {
			file.on("data", (data) => {});
			file.on("limit", () => {});
			file.on("end", () => {});
		});

		busboy.on("field", (fieldname, val, fieldnameTruncated, valTruncated) => {
			req._body ? "" : req._body = true; // flag to prevent other parsers from parsing req for body
			!valTruncated && !fieldnameTruncated ? req.body[fieldname] = val : "";
		});
		busboy.on("finish", () => {
			return next();
		});

		req.pipe(busboy);
	} else {
		return next();
	}
}