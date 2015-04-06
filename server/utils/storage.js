'use strict';

var chai = require('chai');
var Bluebird = require('bluebird');
var fs = Bluebird.promisifyAll(require('fs-extra'));
var path = require('path');
var uuid = require('node-uuid');
var PNGImage = Bluebird.promisifyAll(require('pngjs-image'));
var tarHelper = require('./tarHelper');
var dirHelper = require('./dir-helper');

chai.use(require('chai-as-promised'));
var assert = chai.assert;

var root = path.join(__dirname, '..', '..');
var dataPath = path.join(root, 'data');

function getProjectPath(project) {
  return path.join(dataPath, project);
}

function getBuildsPath(project) {
  return path.join(getProjectPath(project), 'builds');
}

function getShasPath(project) {
  return path.join(getProjectPath(project), 'shas');
}

function getImageFromPath(path) {
  return new Bluebird(function(resolve, reject) {
    var domain = require('domain').create();
    domain.on('error', function(err) {
      reject(err);
    });

    domain.run(function() {
      PNGImage.readImageAsync(path)
  .then(function(image) {
        resolve(image.getImage());
      })
      .catch(function(err) {
        reject(err);
      });
    });
  });
}

var Storage = {
  createProject: function(options) {
    assert.isObject(options);

    var guid = uuid.v4();
    var projectFile = path.join(getProjectPath(guid), 'project.json');
    options.project = guid;

    return fs.outputJSONAsync(projectFile, options)
    .then(function() {
      return {
        project: guid
      };
    });
  },

  hasProject: function(project) {
    return fs.statAsync(path.join(dataPath, project, 'project.json'))
    .then(function(stat) {
      return stat.isFile();
    })
    .catch(function() {
      return false;
    });
  },

  getProjectInfo: function(project) {
    assert.isString(project);

    return assert.eventually.isTrue(this.hasProject(project), 'Unknown Project')
    .then(function() {
      var buildFile = path.join(getProjectPath(project), 'project.json');

      return fs.readJSONAsync(buildFile);
    });
  },

  startBuild: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.head);
    assert.isString(options.base);
    assert.isNumber(options.numBrowsers);

    var guid;

    return assert.eventually.isTrue(this.hasProject(options.project))
    .then(function() {
      guid = uuid.v4();

      var buildFile = path.join(getBuildsPath(options.project), guid, 'build.json');

      return fs.outputJSONAsync(buildFile, {
        build: guid,
        head: options.head,
        base: options.base,
        numBrowsers: options.numBrowsers,
        status: 'pending'
      });
    })
    .then((function() {
      return Bluebird.all([
        this.addBuildToSha({
          project: options.project,
          build: guid,
          sha: options.head
        }),
        this.addBuildToSha({
          project: options.project,
          build: guid,
          sha: options.base
        })
      ]);
    }).bind(this))
    .then(function() {
      return {
        build: guid
      };
    });
  },

  hasBuild: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.build);

    return assert.eventually.isTrue(this.hasProject(options.project))
    .then(function() {
      return fs.statAsync(path.join(getBuildsPath(options.project), options.build, 'build.json'));
    })
    .then(function(stat) {
      return stat.isFile();
    })
    .catch(function(e) {
      return false;
    });
  },

  addBuildToSha: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.build);
    assert.isString(options.sha);

    return assert.eventually.isTrue(this.hasBuild({
      project: options.project,
      build: options.build
    }))
    .then((function() {
      var build = options.build;
      var sha = options.sha;

      var shaBuildsPath = getShasPath(options.project);
      var shaBuildsFile = path.join(shaBuildsPath, sha, 'builds.json');

      return fs.ensureDirAsync(shaBuildsPath)
      .then((function() {
        return this.getBuildsForSha({
          project: options.project,
          sha: sha
        });
      }).bind(this))
      .then(function(builds) {
        builds.push(build);
        return builds;
      }, function() {
        return [build];
      })
      .then(function(buildsArray) {
        return fs.outputJSONAsync(shaBuildsFile, {
          builds: buildsArray
        });
      });
    }).bind(this));
  },

  getBuildsForSha: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.sha);

    return assert.eventually.isTrue(this.hasProject(options.project))
    .then(function() {
      var sha = options.sha;

      var shaPath = path.join(getShasPath(options.project), sha);

      return fs.statAsync(shaPath)
      .then(function(stat) {
        assert(stat.isDirectory(), 'unknown sha');
      })
      .then(function() {
        var shaBuildsFile = path.join(shaPath, 'builds.json');

        try {
          var file = fs.readJSONSync(shaBuildsFile);
          return file.builds;
        }
        catch(err) {
          return [];
        }
      });
    });
  },

  getBuildInfo: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.build);

    return assert.eventually.isTrue(this.hasBuild({
      project: options.project,
      build: options.build
    }))
    .then(function() {
      var buildFile = path.join(getBuildsPath(options.project), options.build, 'build.json');

      return fs.readJSONAsync(buildFile);
    })
    .catch(function() {
      throw Error('Unknown Build');
    });
  },

  updateBuildInfo: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.build);
    assert.isString(options.status);

    if (options.diffs) {
      assert.isObject(options.diffs);
    }

    var status = options.status;
    var diffs = options.diffs;
    var buildFile = path.join(getBuildsPath(options.project), options.build, 'build.json');

    return assert.eventually.isTrue(this.hasBuild({
      project: options.project,
      build: options.build
    }))
    .then(function() {
      return fs.readJSONAsync(buildFile);
    })
    .then(function(data) {
      data.status = status;
      data.diffs = diffs;

      return fs.outputJSONAsync(buildFile, data);
    });
  },

  saveImages: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.browser);
    assert.isString(options.sha);
    assert.isString(options.tarPath);

    var extractPath = path.join(getShasPath(options.project), options.sha, options.browser);

    return assert.eventually.isTrue(this.hasProject(options.project))
    .then(function() {
      return fs.ensureDirAsync(extractPath);
    })
    .then(function() {
      return tarHelper.extractTar(options.tarPath, extractPath);
    });
  },

  getBrowsersForSha: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.sha);

    var shaPath = path.join(getShasPath(options.project), options.sha);

    return assert.eventually.isTrue(this.hasProject(options.project))
    .then(function() {
      return fs.readdirAsync(shaPath);
    })
    .then(function(files) {
      return files.filter(function(file) {
        return fs.statSync(path.join(shaPath, file)).isDirectory();
      });
    });
  },

  getImagesForShaBrowser: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.sha);
    assert.isString(options.browser);

    var project = options.project;
    var sha = options.sha;
    var browser = options.browser;

    return assert.eventually.isTrue(this.hasProject(options.project))
    .then(function() {
      var browserPath = path.join(getShasPath(project), sha, browser);
      return dirHelper.readFiles(browserPath);
    });
  },

  /*
  resolves pngjs
  */
  getImage: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.sha);
    assert.isString(options.browser);
    assert.isString(options.image);

    var project = options.project;
    var sha = options.sha;
    var browser = options.browser;
    var image = options.image;

    var imagePath = path.join(getShasPath(project), sha, browser, image);

    return assert.eventually.isTrue(this.hasProject(options.project))
    .then(function() {
      return getImageFromPath(imagePath);
    });
  },

  /*
  resolve pngjs
  */
  getDiff: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.build);
    assert.isString(options.browser);
    assert.isString(options.image);

    var project = options.project;
    var build = options.build;
    var browser = options.browser;
    var image = options.image;

    var imagePath = path.join(getBuildsPath(project), build, browser, image);

    return assert.eventually.isTrue(this.hasBuild({
      project: options.project,
      build: options.build
    }))
    .then(function() {
      return getImageFromPath(imagePath);
    });
  },

  /*
  options.build string
  options.browser string
  options.imageName string
  options.imageData pngjs
  */
  saveDiffImage: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.build);
    assert.isString(options.browser);
    assert.isString(options.imageName);
    assert.isObject(options.imageData);
    assert.property(options.imageData, 'pack');

    var project = options.project;
    var build = options.build;
    var browser = options.browser;
    var imageName = options.imageName;
    var imageData = options.imageData;

    var folder = path.join(getBuildsPath(project), build, browser);
    var imagePath = path.join(folder, imageName);

    return assert.eventually.isTrue(this.hasBuild({
      project: options.project,
      build: options.build
    }))
    .then(function() {
      return fs.ensureDirAsync(folder);
    })
    .then(function() {
      return new Bluebird(function(resolve) {
        imageData.pack().on('end', function() {
          resolve();
        })
        .pipe(fs.createWriteStream(imagePath));
      });
    });
  }
};

if (process.env.NODE_ENV === 'test') {
  Object.defineProperty(Storage, '_dataPath', {
    get: function() {
      return dataPath;
    },
    set: function(newPath) {
      dataPath = newPath;
    }
  });

  Object.defineProperty(Storage, '_getImageFromPath', {
    get: function() {
      return getImageFromPath;
    },
    set: function(newFunc) {
      getImageFromPath = newFunc;
    }
  });

  Storage._getProjectPath = getProjectPath;
  Storage._getBuildsPath = getBuildsPath;
  Storage._getShasPath = getShasPath;
}

module.exports = Storage;
