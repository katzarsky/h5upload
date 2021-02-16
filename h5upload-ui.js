var HtmlUploader = null; 

(function($, window, document) {

function onBeforeUnloadWindow(e) {
	var message = 'Upload queue still in progress. Your progress will be lost.',
	e = e || window.event;
	if(e) e.returnValue = message;
	return message;
}

var pageTitle = null, pageAttached = null;
var oldSpeed = 0, oldTime = 0, oldProgress = 0, lag = 1000;
function updatePageTitle() {
	var progress=0, size=0, running=false, all=HtmlUploader.instances;
	for(var i = all.length-1; i >= 0; i--) {
		var status = all[i].uploader.getProgress();
		if(status.uploading) {
			size += status.size;
			progress += status.uploaded;
			running = true;
		}
	}

	if(pageTitle === null) {
		pageTitle = document.title;
	}

	if (running) {
		if(!pageAttached) {
			$(window).on('beforeunload', onBeforeUnloadWindow);
			pageAttached = true;
		}
		var speed, now = Date.now();
		if(now - oldTime > lag) {
			speed = Math.max(0, progress - oldProgress) / (now - oldTime);
			speed = (oldSpeed + speed)/2;
			oldTime = now;
			oldProgress = progress;
			oldSpeed = speed;
		} else {
			speed = oldSpeed;
		}
		var percent = Math.round(100*Math.min(1, progress/Math.max(1, size)));
		var speedf = (speed > 500) ? (speed/1000).toFixed(1) + 'M/s' : (speed).toFixed(1) + 'K/s';
		document.title = percent + '% ' + speedf + ' ' + pageTitle;
	} else {
		if(pageAttached) {
			$(window).off('beforeunload', onBeforeUnloadWindow);
			pageAttached = false;
			document.title = pageTitle;
		}
		oldSpeed = oldProgress = oldTime = 0;
	}
};

function mimeFile(file) {
	return "<b class='icon mime-unknown mime-"+file.ext+"'>"+file.name+"</b>";
}

function errorFile(file) {
	return "<span class='filename-error'>" + mimeFile(file) + "</span>" +
		"<div class='filename-tools filename-error'>" +
			file.error +	
			" <a href='#' class='remove-file'><b class='ui-icon ui-icon-red ui-icon-circle-close'></b></a>"+
		"</div>";
}

function no2k(n, prec) {
	var p = typeof prec === 'undefined' ? 1 : prec;
	var g=1000000000, m=1000000, k=1000;
	if(n > g) return Math.round(p*n/g)/p + 'G';
	if(n > m) return Math.round(p*n/m)/p + 'M';
	if(n > k) return Math.round(p*n/k)/p + 'K';
	return n;
}

HtmlUploader = function(node, conf) {	
	this.name = conf.name;
	this.multi = conf.multi;

	this.node = node;
	this.files = null;
	this.header = null;
	this.binds = null;

	var self = this;
	var respawns = this.parseHidden(node);
	conf.autostart = true;
	conf.drop = node.get(0);
	conf.onStateChange = function(e, data, uploader) {
		if (e==='drag') {
			if(data) self.node.addClass('accept-dragdrop');
			else self.node.removeClass('accept-dragdrop');
		} else {
			if(self.multi) self.renderMulti();
			else self.renderSingle();
			updatePageTitle();
			if(e !== 'file.uploading') {
				self.mutateHidden(self.node, uploader.queue);
				self.node.trigger('upload.'+e, {ui: self, uploader: uploader, data: data});
			}
		}
	};

	if(this.multi) this.initMulti(conf);
	else this.initSingle(conf);

	this.respawnFiles(respawns);
	this.bind(true);
	HtmlUploader.instances.push(this);
};

HtmlUploader.instances = [];

HtmlUploader.prototype.destroy = function() {
	this.uploader.abort();
	this.uploader.bind(false);
	this.bind(false);
	for(var i=0; i<HtmlUploader.instances.length; i++) {
		if(HtmlUploader.instances[i] === this) {
			HtmlUploader.instances.slice(i--, 1);
			break;
		}
	}
};

HtmlUploader.findInstance = function(node) {
	for(var i=0; i<HtmlUploader.instances.length; i++) {
		if(HtmlUploader.instances[i].node.is(node)) return i;
	}
	return -1;
};

HtmlUploader.prototype.renderFilter = function() {
	var ext=[], min=[], max=[], f = this.uploader.filters;
	if(f.extensions && f.extensions.length > 0) {
		ext = f.extensions.map(function(e) {
			return "<i class='filt'>" + e.toUpperCase() + "</i>";
		});
	}
	if(f.minDimensions) {
		min.push(f.minDimensions.width+'x'+f.minDimensions.height + 'px');
	}
	if(f.maxDimensions) {
		max.push(f.maxDimensions.width+'x'+f.maxDimensions.height + 'px');
	}
	if(f.maxSize) {
		max.push(no2k(f.maxSize));
	}
	if(min.length > 0) {
		ext.push("<b class='filt'> Min: " + min.join(' ') + "</b>");
	}
	if(max.length > 0) {
		ext.push("<b class='filt'> Max: " + max.join(' ') + "</b>");
	}
	return "<div class='ext-filters'>" + ext.join(' ') + "</div>";
};

HtmlUploader.prototype.mutateHidden = function(node, queue) {
	var name = (this.name ? this.name : 'null') + (this.multi ? '[]' : '');
	var uuids = [];
	for(var i=0; i<queue.length; i++) {
		var file = queue[i];
		if(file.completed) {
			uuids.push(file.uuid);
			var e = $('input[type=hidden][rel="'+file.uuid+'"]', node);
			var json = JSON.stringify({uuid: file.uuid, name: file.name, size: file.size});
			if(e.length === 0) {
				e = $("<input type='hidden'>");
				e.attr({rel: file.uuid, name: name, value: json});
				node.append(e);
			}
			else if(e.attr('value') !== json) {
				e.attr('value', json);
			}
			if(!this.multi) break;
		}
	}
	$('input[type=hidden]', node).each(function() {
		if(uuids.indexOf($(this).attr('rel')) === -1) $(this).remove();
	});
};

HtmlUploader.prototype.parseHidden = function(node) {
	var hidden = $('input[type=hidden]', node);
	var files = [];
	if(this.name) {
		var name = this.name + (this.multi ? '[]' : '');
		hidden.each(function() {
			if($(this).attr('name') === name) {
				files.push(JSON.parse($(this).attr('value')));
			}
		});
	}
	return files;
};

HtmlUploader.prototype.respawnFiles = function(files) {
	var len = this.uploader.multi ? files.length : Math.min(1, files.length);
	for(var i=0; i < len; i++) {
		var f = files[i];
		this.uploader.addFile({
			uuid: f.uuid,
			name: f.name,
			size: f.size,
			lastModified: f.modified || 0
		}, null, true);
	}
};

HtmlUploader.prototype.bind = function(bind) {
	if(this.binds === null) {
		var self = this;
		this.binds = {
			removeFiles: function() {
				if(self.multi && $(this).is('a.remove-file')) {
					self.uploader.removeFile($(this).closest('li').data('uuid'), true);
				} else {
					self.uploader.removeFiles(null, true);
				}
				return false;
			}
		};
	}

	if(bind) this.node.on('click', 'a.remove-file, a.remove-all', this.binds.removeFiles);
	else this.node.off('click', 'a.remove-file, a.remove-all', this.binds.removeFiles);
};

HtmlUploader.prototype.initSingle = function(conf) {
	var node = this.node;
	node.addClass('file-uploader file-uploader-single').html(
		"<div class='file-uploader-browse'>"+
			"<button type='button' class='ui-button ui-corner-all ui-uncorner-right ui-button-grey'>"+
				"<b class='ui-icon ui-icon-upload'></b> Upload"+
			"</button>" +
			"<input type='file' style='opacity:0'>"+
		"</div>"+
		"<div class='selected-file ui-corner-all ui-uncorner-left'></div>"
	);		
	this.files = $('.selected-file', node);
	conf.input = $('input[type=file]', node).get(0);
	conf.button = $('.file-uploader-browse button', node).get(0);
	this.uploader = new H5Upload(conf);
	this.files.html(this.renderFilter());
};

HtmlUploader.prototype.initMulti = function(conf) {
	var node = this.node;
	node.addClass('file-uploader file-uploader-multi').html(
		"<div class='header'>" +		
			"<div class='file-uploader-browse'>"+
				"<button type='button' class='ui-button ui-corner-tl ui-button-grey'>"+
					"<b class='ui-icon ui-icon-upload'></b> " +
					"Upload Files"+
				"</button>" +
				"<input type='file' style='opacity:0' multiple>"+
			"</div>"+
			"<div class='total'>"+
				"<div class='filename-tools'>"+
					"<b class='size'></b>" +
					"<b class='ui-progressbar'><b class='ui-progressbar-value'></b></b>" +
					"<a href='#' class='remove-all'><b class='ui-icon ui-icon-black ui-icon-circle-close'></b></a>"+
				"</div>" +
			"</div>" +
		"</div>" +
		"<ul class='files'></ul>" +
		"<div class='drop-zone'>" +
			"<div class='errors'></div>" +
			"<b class='ui-icon ui-icon-upload'></b> " +
			"Drop files here" +
		"</div>"
	);
	this.files = $('.files', node);
	this.header = $('.header', node);
	conf.input = $('input[type=file]', node).get(0);
	conf.button = $('.file-uploader-browse button', node).get(0);	
	this.uploader = new H5Upload(conf);
	$('.ui-progressbar, .remove-all', this.header).hide();
	$('.drop-zone', node).append(this.renderFilter());
};

HtmlUploader.prototype.renderSingle = function() {
	var files = this.files, q = this.uploader.queue;
	var	file = q.length > 0 ? q[q.length - 1] : null;

	if(!file) {
		files.html(this.renderFilter());
	}
	else if(file.error) {
		files.html(errorFile(file));
	}
	else {
		if(files.data('uuid') !== file.uuid) {
			files.html(
				"<div class='filename'>" + mimeFile(file) + "</div>" +
				"<div class='filename-tools'>" +
					"<b class='size'>" + no2k(file.size, 10) + "</b>" +
					"<b class='progress ui-progressbar'><b class='ui-progressbar-value'></b></b>" +
					"<a href='#' class='remove-file'><b class='ui-icon ui-icon-black ui-icon-circle-close'></b></a>"+
				"</div>"
			);
		} else {
			$('.filename b', files).text(file.name);
		}
		if(file.uploading) {
			$('.ui-progressbar .ui-progressbar-value', files).css('width', (100*file.uploaded/file.size).toFixed(2)+'%');
			$('.ui-progressbar', files).show();
		} else {
			$('.ui-progressbar', files).hide();
		}			
	}
	files.data('uuid', file ? file.uuid : '');
};

HtmlUploader.prototype.renderMulti = function() {
	var files = this.files,
		header = this.header,
		queue = this.uploader.queue,
		uuids = [];

	for(var i=0; i < queue.length; i++) {
		var file = queue[i], row = $('li[data-uuid="'+file.uuid+'"]', files);
		uuids.push(file.uuid);

		if(row.length === 0) {
			row = $("<li data-uuid='"+file.uuid+"'>" +
				"<div class='filename'>" + mimeFile(file) + "</div>" +
				"<div class='filename-tools'>" +
					"<b class='size'>" + no2k(file.size, 10) + "</b>" +
					"<b class='progress ui-progressbar'><b class='ui-progressbar-value'></b></b>" +
					"<a href='#' class='remove-file'><b class='ui-icon ui-icon-black ui-icon-circle-close'></b></a> "+
				"</div>"+
			"</li>");
			files.append(row);
		} else {
			$('.filename b', row).text(file.name);
		}

		if(file.error) {
			row.html(errorFile(file));
		} else if(file.completed) {
			$('.ui-progressbar', row).hide();
		} else {
			$('.ui-progressbar .ui-progressbar-value', row).css('width', (100*file.uploaded/file.size).toFixed(2)+'%');
			$('.ui-progressbar', row).show();				
		}		
	}

	$('li[data-uuid]', files).each(function() {
		if(uuids.indexOf($(this).data('uuid')) === -1) {
			$(this).remove();
		}
	});

	if(queue.length > 0) {
		var progress = this.uploader.getProgress();
		$('.remove-all', header).show();
		$('.size', header).text(no2k(progress.size, 10));
		var bar = $('.ui-progressbar', header);
		if(progress.uploading) {
			bar.show();
			$('.ui-progressbar-value', bar).css('width', (100*progress.uploaded/progress.size).toFixed(2)+'%');
		} else {
			bar.hide();
		}
	} else {
		$('.remove-all, .ui-progressbar', header).hide();
		$('.size', header).text('');
	}
};

$.fn.uploader = function(config) {
	return $(this).each(function() {		
		if(config === 'destroy') {
			var i = HtmlUploader.findInstance($(this));
			if(i >= 0) HtmlUploader.instances[i].destroy();
		} else {
			new HtmlUploader($(this), $.extend({}, $(this).data('settings'), config));
		}
	});
};

}($, window, document));
