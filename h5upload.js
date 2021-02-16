
function H5Upload(conf) {
	this.input = conf.input; // file input DOM pointer
	this.button = conf.button; // browse button element DOM pointer
	this.drop = conf.drop; // drop element DOM pointer
	this.url = conf.url; // upload url
	this.chunkSize = conf.chunkSize || 1048576; // 1Mb
	this.retries = conf.retries || 3;
	this.autostart = conf.autostart || false;
	this.multi = conf.multi || false;
	this.duplicates = conf.duplicates || false;
	this.params = conf.params || {};
	this.onStateChange = conf.onStateChange || null;
	this.filters = {
		extensions: Array.isArray(conf.extensions) ? conf.extensions : null, // null means everything is allowed
		maxSize: H5Upload.k2no(conf.maxSize || 0), // 0 means no size limit
		imageExtensions: Array.isArray(conf.imageExtensions) ? conf.imageExtensions : ['bmp', 'jpg', 'jpeg', 'png', 'gif'],
		minDimensions: H5Upload.wxh(conf.minDimensions || null),
		maxDimensions: H5Upload.wxh(conf.maxDimensions || null)
	};

	this.queue = [];
	this.uploading = false;
	this.dragging = false;
	this.binds = null;
	
	if(this.filters.extensions && this.filters.extensions.length > 0) {
		var accept = this.filters.extensions.map(function(ext) { return '.'+ext; }).join(',');
		this.input.setAttribute('accept', accept);
	} else {
		this.input.removeAttribute('accept');
	}
	
	this.bind(true);
}

H5Upload.prototype.bind = function(bind) {
	var self = this; 
	
	if(self.binds === null) {
		self.binds = {
			onFiles: function() { self.addFiles(this.files); },
			onClick: function() { self.input.click(); },
			onDrag: function(e) {
				e.preventDefault();
				e.stopPropagation();
				if(!self.dragging) {
					self.dragging = true;
					self.trigger('drag', self.dragging);
				}
			},
			onDrop: function(e) {
				e.preventDefault();
				e.stopPropagation();
				if(e.type === 'dragleave' && H5Upload.hasParentNode(e.relatedTarget, self.drop)) return;
				self.dragging = false;
				self.trigger('drag', self.dragging);
				if(e.type === 'drop' && e.dataTransfer.files.length > 0) {
					self.addFiles(e.dataTransfer.files);
				}
			}
		};
	}
	if(this.input) {
		if(bind) this.input.addEventListener('change', self.binds.onFiles);
		else this.input.removeEventListener('change', self.binds.onFiles);
	}
	if(this.button) {
		if(bind) this.button.addEventListener('click', self.binds.onClick);
		else this.button.removeEventListener('click', self.binds.onClick);
	}
	if(this.drop && H5Upload.canDrop()) {
		['drag', 'dragstart', 'dragover', 'dragenter'].forEach(function(n) {
			if(bind) self.drop.addEventListener(n, self.binds.onDrag);
			else self.drop.removeEventListener(n, self.binds.onDrag);
		});
		['dragleave', 'dragend', 'drop'].forEach( function(n) {
			if(bind) self.drop.addEventListener(n, self.binds.onDrop);
			else self.drop.removeEventListener(n, self.binds.onDrop);
		});
	}
}
	
H5Upload.prototype.addFiles = function(files) {
	var i = 0, self = this;
	if(!this.multi) {
		this.removeFiles();
	}
	function next() {
		if(i < files.length) {
			self.addFile(files[i], function() {
				i++;
				next();
			});
		} else {
			self.trigger('files');
			if(self.autostart) {
				self.start();
			}
		}
	}
	if(files.length > 0) next();
};

H5Upload.prototype.addFile = function(file, cb, completed) {
	completed = completed || false;
	var ext = H5Upload.ext(file.name).toLowerCase();
	var upload = {
		uuid: completed ? file.uuid : H5Upload.uuidv4() + (ext ? '.'+ext : ''),
		valid: completed ? true : null,
		error: null,
		uploaded: completed ? file.size : 0,
		uploading: false,
		completed: completed,
		chunk: 0,
		retries: 0,
		blob: completed ? null : file,
		xhr: null,
		name: file.name,
		size: file.size,
		modified: Math.floor(file.lastModified/1000),
		ext: ext
	};
	var self = this;
	this.validateUpload(upload, function(upload) {
		self.queue.push(upload);
		self.trigger('file.add', upload);
		cb && cb(upload);
	});
};

H5Upload.prototype.validateUpload = function(upload, cb) {
	var f = this.filters;
	if(f.maxSize && f.maxSize < upload.size) {
		upload.error = 'Max file size';
		upload.valid = false;
	}
	if(f.extensions && f.extensions.length > 0 && f.extensions.indexOf(upload.ext) === -1) {
		upload.error = 'File extension '+upload.ext+' is not allowed';
		upload.valid = false;
	}
	if(upload.valid === null && f.imageExtensions.indexOf(upload.ext) >= 0) {
		function finalize(img) {
			var w=0, h=0;
			if(img && img.width > 0 && img.height > 0) {
				w = img.width;
				h = img.height;
			}
			upload.valid = true;
			if(f.minDimensions && (w < f.minDimensions.width || h < f.minDimensions.height)) {
				upload.valid = false;
			} else if(f.maxDimensions && (w > f.maxDimensions.width || h > f.maxDimensions.height)) {
				upload.valid = false;
			} else if(w===0 || h===0) {
				upload.valid = false;
			}
			upload.error = upload.valid ? null : 'Invalid image dimensions '+w+'x'+h;
			cb && cb(upload);
		}
		var img = new Image();
		img.src = URL.createObjectURL(upload.blob);
		img.onload = function() { finalize(img); };
		img.onerror = function() { finalize(null); };
	} else {
		if(upload.valid === null) {
			upload.valid = true;
		}
		cb && cb(upload);
	}
};

H5Upload.prototype.start = function() {
	if(!this.uploading) {
		this.uploading = true;
		for(var i=0; i<this.queue.length; i++) {
			this.queue[i].retries = 0;
		}
		this.trigger('start');
		this.next();
	}
};

H5Upload.prototype.pause = function() {
	this.uploading = false;
	this.trigger('pause');
};

H5Upload.prototype.abort = function() {
	this.uploading = false;
	for(var i=0; i<this.queue.length; i++) {
		if(this.queue[i].xhr) {
			this.queue[i].xhr.abort();
		}
	}
	this.trigger('abort');
};

H5Upload.prototype.next = function() {
	if(this.uploading) {
		var processing = false;
		for(var i=0; i<this.queue.length; i++) {
			var upload = this.queue[i];
			if(upload.valid && !upload.completed) {
				if(this.uploadChunk(upload)) {
					processing = true;
					break;
				} else {
					this.trigger('file.completed', upload);
				}
			}
		}
		this.uploading = processing;
		if(!this.uploading) {
			this.trigger('completed');
		}
	}
};

H5Upload.prototype.uploadChunk = function(upload) {
	var self = this;
	var start = this.chunkSize*upload.chunk;
	upload.uploading = true;
	if(upload.chunk === 0) {
		this.trigger('file.uploading', upload);
	} else if(start >= upload.size) {
		upload.completed = true;
		upload.uploading = false;
		upload.uploaded = upload.size;
		upload.blob = null;
		return false;
	}
	var end = Math.min(start + this.chunkSize, upload.size);
	var chunk = upload.blob.slice(start, end);
	var chunksize = end - start;
	var form = new FormData();
	for(var k in this.params) {
		form.append(k, this.params[k]);
	}
	form.append('uuid', upload.uuid);
	form.append('chunk', upload.chunk);
	form.append('chunks', Math.ceil(upload.size / this.chunkSize));
	form.append('name', upload.name);
	form.append('size', upload.size);
	form.append('modified', upload.modified);
	form.append('file', chunk);

	var xhr = new XMLHttpRequest();
	upload.xhr = xhr;
	xhr.upload.addEventListener('progress', function(e) {
		if(e.lengthComputable) {
			var factor = e.total ? chunksize / e.total : 1;
			upload.uploaded = start + Math.min(chunksize, e.loaded*factor);
			self.trigger('file.uploading', upload);
		}
	});
	xhr.onreadystatechange = function() {
		if(xhr.readyState === 4) { // XMLHttpRequest.DONE
			var status = xhr.status;
			var data = {};
			try { data = JSON.parse(xhr.responseText); } catch(e) {};
			if(!upload.valid) {
				upload.uploading = false;
				self.next();
			} else if(status === 0) { // aborted
				upload.uploading = false;
				self.uploading = false;
			} else if (status >= 200 && status < 400) { // ok
				if(data.uuid) upload.uuid = data.uuid;
				if(data.filename) upload.name = data.filename; // backend sanitizes filenames
				upload.retries = 0;
				upload.uploaded = end;
				upload.chunk++;
				self.trigger('file.uploading', upload);
				self.next();
			} else if(upload.retries >= this.retries) {
				upload.retries++;
				self.next();
			} else {
				self.uploading = false;
				upload.uploading = false;
				upload.error = 'Server returned: '+status;
				self.trigger('file.error', upload);
			}
		}
	};
	xhr.open('POST', this.url, true);
	xhr.setRequestHeader('content-range', 'bytes '+start+'-'+end+'/'+upload.size);
	xhr.send(form);
	return true;
};

H5Upload.prototype.removeFiles = function(uuids, del) {
	var delete_uuids=[];
	for(var i=0; i<this.queue.length; i++) {
		var f = this.queue[i];
		if(!uuids || uuids.indexOf(f.uuid) >= 0) {
			if(f.xhr) {
				f.valid = false;
				f.xhr.abort();
			}
			if(f.uploading || f.uploaded > 0 || f.completed) {
				delete_uuids.push(f.uuid);
			}
			this.queue.splice(i--, 1);
			this.trigger('file.remove', f);
		}
	}
	if(del) {
		this.deleteFiles(delete_uuids);
	}
};

H5Upload.prototype.removeFile = function(uuid, del) {
	this.removeFiles([uuid], del);
};

H5Upload.prototype.deleteFiles = function(uuids) {
	if(uuids.length > 0) {
		var data = {};
		for(var k in this.params) {
			data[k] = this.params[k];
		}
		data.action = 'delete';
		data.uuids = uuids;
		
		var xhr = new XMLHttpRequest();
		xhr.open('PATCH', this.url, true);
		xhr.setRequestHeader('content-type', 'application/json');
		xhr.send(JSON.stringify(data));
	}
};

H5Upload.prototype.trigger = function(evt, data) {
	if(this.onStateChange) {
		this.onStateChange(evt, data, this);
	}
};

H5Upload.prototype.getProgress = function() {
	var status = {
		uploading: this.uploading,
		uploaded: 0,
		size: 0
	};
	for (var i=0; i < this.queue.length; i++) {
		var f = this.queue[i];
		if(!f.error && f.valid) {
			status.size += f.size;
			status.uploaded += f.uploaded;
		}
	}
	return status;
};

H5Upload.uuidv4 = function () {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
		var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
};

H5Upload.wxh = function(str) {
	if(typeof str === 'string' && str.indexOf('x') >= 0) {
		var arr = str.split('x');
		if(arr.length === 2 && arr[0] > 0 && arr[1] > 0) {
			return {width: arr[0], height: arr[1]};
		}
	}
	return str || null;
};

H5Upload.k2no = function(str) {
	if(typeof s === 'string') {
		var mul = 1, s = str.toLowerCase();
		if(s.indexOf('k') > 0) mul = 1000;
		else if(s.indexOf('m') > 0) mul = 1000*1000;
		else if(s.indexOf('g') > 0) mul = 1000*1000*1000;
		return parseFloat(str)*mul;
	}
	return str;
};

H5Upload.ext = function(filename) {
	return (filename.indexOf('.') >= 0) ? filename.split('.').pop() : '';
};

H5Upload.canDrop = function() {
	var div = document.createElement( 'div' );
	return ( ( 'draggable' in div ) || ( 'ondragstart' in div && 'ondrop' in div ) ) && 'FormData' in window && 'FileReader' in window;
};

H5Upload.hasParentNode = function(node, parent) {
	while(node) {
		if(node === parent) return true;
		node = node.parentNode;
	}
	return false;
};
