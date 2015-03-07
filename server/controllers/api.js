'use strict';

var fs = require('fs-extra');
var path = require('path');

var glob = require('glob');
var async = require('async');
var readDir = require('../utils/dirHelper');
var mainBranch = 'master';
var resemble = require('node-resemble-js');

var dirHelper = require('../utils/dirHelper');

var storage = require('../utils/storage');

function Api() {
  storage.init();
}

Api.prototype = {
  startBuild: function(req, res) {
    var params = req.body;

    var head = params.head;
    var base = params.base;
    var numBrowsers = params.numBrowsers;

    if (!head || !base || !numBrowsers) {
      res.send(400, {
        status: 'failure',
        message: 'invalid arguments'
      });
    }

    storage.startBuild({
      head: head,
      base: base,
      numBrowsers: numBrowsers
    })
    .then(function(result) {
      res.send({
        status: 'success',
        build: result.id
      });
    })
    .catch(function() {
      res.send(500, {
        status: 'failure',
        message: 'error starting build'
      });
    });
  },

  upload: function(req, res) {
    var params = req.body;

    var sha;
    var browser;
    var files;
    var images;

    try {
      sha = params.sha;
      browser = params.browser;
      files = req.files;
      images = files.images;
    }
    finally {
      if (!sha || !browser || !files || !images) {
        res.send(400, {
          status: 'failure',
          message: 'invalid arguments'
        });
        return;
      }
    }

    // TODO: validate the structure of the tar file
    storage.saveImages({
      sha: sha,
      browser: browser,
      tarPath: images.path
    })
    .then(function() {
      res.send(200, {
        status: 'success'
      });
    })
    .catch(function() {
      res.send(500, {
        status: 'failure',
        message: 'failed uploading'
      });
    });
  },

  getBuild: function(req, res) {
    throw new Error('not implemented');
  },

  confirm: function(req, res) {
    throw new Error('not implemented');
  },

  getImage: function(req, res) {
    throw new Error('not implemented');
  },

  getDiff: function(req, res) {
    throw new Error('not implemented');
  }
};

module.exports = new Api();

return;

exports.syncImages = function(req, res) {

  if (!req.files || !req.body.branchName) {
    return res.send(500);
  }

  // We don't want to allow sub-folders
  var branchName = req.body.branchName.replace('/', '-');
  var branchFolder = path.join(imageRepo, branchName);

  fs.readFile(req.files.gz.path, function(err, data) {
    var newPath = path.join(branchFolder, req.files.gz.name);

    fs.remove(newPath.replace(/\.tar\.gz/, ''), function(err) {
      if (err) {
        throw err;
      }

      fs.outputFile(newPath, data, function(err) {
        if (err) {
          throw (err);
        }

        new targz().extract(newPath, branchFolder);
        res.send(200);
      });

    });
  });

};

exports.getBranches = function(req, res) {
  fs.readdir(imageRepo, function(err, files) {
    var dirs = [];

    var checkDirectory = function(file, filePath, isLast) {
      fs.stat(filePath, function(err, stat) {

        if (stat.isDirectory() && file !== mainBranch) {
          dirs.push(file);
        }

        if (isLast) {
          res.send(dirs);
        }
      });
    };

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file === '.') {
        continue;
      }

      var filePath = path.join(imageRepo, file);
      var isLast = (i === files.length - 1);
      checkDirectory(file, filePath, isLast);
    }
  });
};

exports.getDiffs = function(req, res) {
  if (!req.query || !req.query.branchName) {
    res.send(500);
    return;
  }

  var branchName = req.query.branchName;

  var branchPath = path.join(imageRepo, branchName);
  readDir.getImagesInBranch(branchPath, function(err, images) {
    if (err) {
      res.send(500);
      return;
    }

    console.log(images);
    res.send(images);
  });


  // console.log('reading', master);
  // readDir.listDirectory(master, function(err, dir) {
  //     console.log(dir);
  // });
};

exports.getDiff = function(req, res) {
  var params = req.params;
  var oldFilePath = path.join(imageRepo, 'master', params.browser, params.file);
  var newFilePath = path.join(imageRepo, params.branchName, params.browser, params.file);

  resemble(oldFilePath)
      .compareTo(newFilePath)
        .onComplete(function(image) {
          res.writeHead(200, {
              'Content-Type': 'image/png'
            });

          image.getDiffImage().pack().pipe(res);
        });
};

exports.getBranchImage = function(req, res) {
  var params = req.params;
  var filePath = path.join(imageRepo, params.branchName, params.browser, params.file);

  res.sendfile(filePath, {}, function(err) {
    if (err) {
      return res.send(404);
    }
  });
};

exports.getImage = function(req, res) {

  var processed = 0,
      filepath;

  /**
   * read directory to check if hash matches given files
   */
  fs.readdir(imageRepo, function(err, files) {

    if (err || files.length === 0) {
      return res.send(404);
    }

    files.forEach(function(file) {

      /**
       * continue if hash doesnt match url param
       */
      if (file !== req.params.project) {

        /**
         * return 404 after all directories were checked
         */
        if (++processed === files.length) {
          return res.send(404);
        }

        return true;
      }

      /**
       * directory was found
       * generate file path
       */
      if (req.params.file) {
        filepath = path.join(imageRepo, file, req.params.file);
      } else {
        filepath = path.join(imageRepo, file, 'diff', req.params.diff);
      }

      /**
       * check if requested file exists
       * return 404 if file doesn't exist otherwise send file content
       */
      res.sendfile(filepath, {}, function(err) {
        if (err) {
          return res.send(404);
        }
      });

    });

  });

};

exports.downloadRepository = function(req, res) {

  var file = req.params.file,
      project = file.replace(/\.tar\.gz/, ''),
      tmpPath = path.join(__dirname, '..', '..', '.tmp', 'webdrivercss-adminpanel', project),
      tarPath = tmpPath + '.tar.gz',
      projectPath = path.join(imageRepo, project);

  /**
   * create tmp directory and create tarball to download on the fly
   */
  async.waterfall([
      /**
       * check if project exists
       */
       function(done) {
          return fs.exists(projectPath, done.bind(this, null));
        },
        /**
         * make tmp dir
         */
        function(isExisting, done) {
          if (!isExisting) {
            return res.send(404);
          }

          return glob(projectPath + '/**/*.baseline.png', done);
        },
        /**
         * copy these files
         */
        function(files, done) {
          return async.map(files, function(file, cb) {
            return fs.copy(file, file.replace(projectPath, tmpPath), cb);
          }, done);
        },
        /**
         * create diff directory (webdrivercss breaks otherwise)
         */
        function(res, done) {
          return fs.ensureDir(tmpPath + '/diff', done);
        },
        /**
         * zip cleared
         */
        function(res, done) {
          return new targz().compress(tmpPath, tarPath, done);
        }
    ], function(err) {

      if (err) {
        return res.send(500);
      }

      res.sendfile(tarPath);

      /**
       * delete tmp directory
       */
      fs.remove(path.join(tmpPath, '..'));

    });

};

exports.acceptDiff = function(req, res) {

  var newFile = req.body.file,
      currentFile = newFile.replace('.new.png', '.baseline.png'),
      diffFile = newFile.replace('.new.png', '.diff.png'),
      project = null,
      processed = 0;

  /**
   * read directory to check if hash matches given files
   */
  async.waterfall([
      /**
       * get uploads dir filestructure
       */
       function(done) {
          return fs.readdir(imageRepo, done);
        },
        /**
         * iterate through all files
         */
        function(files, done) {

          if (files.length === 0) {
            return done(404);
          }

          return files.forEach(function(file) {
            return done(null, files, file);
          });
        },
        /**
         * check if directory matches with given hash and overwrite new file with current file
         */
        function(files, file, done) {

          /**
           * continue if hash doesnt match url param
           */
          if (file !== req.body.project) {

            /**
             * return 404 after all directories were checked
             */
            if (++processed === files.length) {
              return done(403);
            }

            return true;
          }

          project = file;

          var source = path.join(imageRepo, project, newFile),
              dest = path.join(imageRepo, project, currentFile);

          return fs.copy(source, dest, done);

        },
        /**
         * remove obsolete new.png file
         */
        function(done) {
          return fs.remove(path.join(imageRepo, project, newFile), done);
        },
        /**
         * remove diff file
         */
        function(done) {
          return fs.remove(path.join(imageRepo, project, 'diff', diffFile), done);
        }
    ], function(err) {

      if (err) {
        return res.send(err);
      }

      res.send(200);

    });

};
