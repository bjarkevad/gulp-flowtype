/* @flow weak */
'use strict';


var Q = require('q');
var fs = require('fs');
require('babel-polyfill');
var path = require('path');
var gutil = require('gulp-util');
var through = require('through2');
var flowBin = require('flow-bin');
var logSymbols = require('log-symbols');
var childProcess = require('child_process');
var flowToJshint = require('flow-to-jshint');
var stylishReporter = require('jshint-stylish').reporter;

/**
 * Flow check initialises a server per folder when run,
 * we can store these paths and kill them later if need be.
 */
var servers = [];
var passed = true;

/**
 * Wrap critical Flow exception into default Error json format
 */
function fatalError(stderr) {
    return {
        errors: [{
                    message: [{
                                 path: '',
                                     code: 0,
                                     line: 0,
                                     start: 0,
                                     descr: stderr
                             }]
                }]
    };
}

function optsToArgs(opts) {
    var args = [];

    if (opts.all) {
        args.push('--all');
    }
    if (opts.weak) {
        args.push('--weak');
    }
    if (opts.declarations) {
        args.push('--lib', opts.declarations);
    }

    return args;
}

function getFlowBin() {
    var res = process.env.FLOW_BIN || flowBin;
    console.log('Using flow found in: ' + res);
    return res;
}

function executeFlow (options) {
    console.log('Executing flow in: '+ process.cwd());
    var deferred = Q.defer();

    var opts = optsToArgs(options);

    var stream;
    try {
        stream = childProcess.spawn(getFlowBin(), ['--json']);
    } catch(e) {
        console.log(e);
    }

    stream.stdout.on('data', data => {
        var parsed;
        try {
            parsed = JSON.parse(data.toString());
        }
        catch(e) {
            parsed = fatalError(data.toString());
        }

        var result = {};

        // loop through errors in file
        result.errors = parsed.errors.filter(function (error) {
            //let isCurrentFile = error.message[0].path; //=== _path;
            //console.log(error.message[0].descr);
            console.log(error.message[0].descr);

            return true; // || isCurrentFile;
        });

        console.log(parsed.errors);

        if (result.errors.length) {
            passed = false;

            var reporter = typeof options.reporter === 'undefined' ?
                stylishReporter : options.reporter.reporter;

           reporter(flowToJshint(result));
                deferred.reject(new gutil.PluginError('gulp-flow', 'Flow failed'));

            //if (options.abort) {
                //deferred.reject(new gutil.PluginError('gulp-flow', 'Flow failed'));
            //}
            //else {
                //deferred.resolve();
            //}
        }
        else {
            deferred.resolve();
        }
    });

    return deferred.promise;
}

function checkFlowConfigExist() {
    var deferred = Q.defer();
    var config = path.join(process.cwd(), '.flowconfig');
    fs.exists(config, function(exists) {
        if (exists) {
            deferred.resolve();
        }
        else {
            deferred.reject('Missing .flowconfig in the current working directory.');
        }
    });
    return deferred.promise;
}

function hasJsxPragma(contents) {
    return /@flow\b/ig
        .test(contents);
}

function isFileSuitable(file) {
    var deferred = Q.defer();
    deferred.resolve();
    return deferred.promise;
}

function killServers() {
    var defers = servers.map(function(_path) {
        var deferred = Q.defer();
        childProcess.execFile(getFlowBin(), ['stop'], {
            cwd: _path
        }, deferred.resolve);
        return deferred;
    });
    return Q.all(defers);
}

var firstRun = true;

module.exports = function (options={}) {
    options.beep = typeof options.beep !== 'undefined' ? options.beep : true;

    function Flow(file, enc, callback) {
        var _continue = () => {
            this.push(file);
            callback();
        };

        isFileSuitable(file).then(() => {
            if (firstRun) {
                checkFlowConfigExist().then(() => {
                    executeFlow(file.path, options).then(() => {
                        firstRun = false;
                        _continue()}, err => {
                            this.emit('error', err);
                            firstRun = false;
                            callback();
                        });
                }, msg => {
                    console.log(logSymbols.warning + ' ' + msg);
                    firstRun = false;
                    _continue();
                });
            } else {
                _continue();
            }
        }, err => {
            if (err) {
                this.emit('error', err);
            }
            callback();
        });
    }


    return through.obj(Flow, function () {
        var end = () => {
            this.emit('end');
            passed = true;
        };

        if (passed) {
            console.log(logSymbols.success + ' Flow has found 0 errors');
        } else if (options.beep) {
            gutil.beep();
        }

        if (options.killFlow) {
            if (servers.length) {
                killServers().done(end);
            }
            else {
                end();
            }
        } else {
            end();
        }
    });
};
