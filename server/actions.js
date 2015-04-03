'use strict';

var assert = require('chai').assert;
var dispatcher = require('./dispatcher');
var constants = require('./constants');

var Actions = {
  diffSha: function(sha) {
    dispatcher.emit(constants.diffSha, {
      sha: sha
    });
  },

  setBuildStatus: function(options) {
    assert.isObject(options);
    assert.isString(options.project);
    assert.isString(options.sha);
    assert.isString(options.status);

    dispatcher.emit(constants.setBuildStatus, {
      project: options.project,
      sha: options.sha,
      status: options.status
    });
  }
};

module.exports = Actions;
