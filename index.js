"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-ignore
const xml2js_1 = require("xml2js");
const child_process_1 = require("child_process");
function xmlToJSON(xml) {
    return new Promise((resolve, reject) => {
        xml2js_1.parseString(xml, {
            explicitRoot: false,
            explicitArray: false
        }, (err, result) => {
            if (err) {
                return reject(err);
            }
            resolve(result);
        });
    });
}
function rStream(stream, isBuffer) {
    return new Promise((resolve, reject) => {
        var datas = [];
        stream.on('data', (chunk) => {
            datas.push(chunk);
        });
        stream.on('end', () => {
            if (isBuffer) {
                resolve(Buffer.concat(datas));
            }
            else {
                resolve(datas.join(''));
            }
        });
        stream.on('error', reject);
    });
}
async function execute(name, args = {}) {
    var params = [name, '--non-interactive', '--trust-server-cert'];
    var opts = {};
    if (args.cwd) {
        opts.cwd = args.cwd;
        delete args.cwd;
    }
    if (args.params) {
        params.push(...args.params);
        delete args.params;
    }
    Object.keys(args).forEach(key => {
        var v = args[key];
        if (key.startsWith('-')) {
            params.push(key);
        }
        else {
            params.push('--' + key);
        }
        if (v !== true) {
            params.push(v);
        }
    });
    var ps = child_process_1.spawn('svn', params, opts);
    var [a, b] = await Promise.all([rStream(ps.stdout), rStream(ps.stderr)]);
    var v = a || b;
    if (a) {
        if (args.xml) {
            return xmlToJSON(a);
        }
    }
    else if (b) {
        throw b;
    }
    return a;
}
var getEntryPath = (item) => item.path;
var isType = (type) => (item) => item.type === type;
var isDeletedEntry = isType('deleted');
var isNewEntry = isType('unversioned');
var isMissingEntry = isType('missing');
var isModifiedEntry = isType('modified');
var isConflictEntry = (item) => item.hasConflict;
class SVN {
    constructor(dir) {
        this.dir = dir;
    }
    async status() {
        var data = await status(this.dir);
        this.hasChanges = data.length > 0;
        this.conflicts = data.filter(isConflictEntry).map(getEntryPath);
        this.deleteds = data.filter(isDeletedEntry).map(getEntryPath);
        this.adds = data.filter(isNewEntry).map(getEntryPath);
        this.missings = data.filter(isMissingEntry).map(getEntryPath);
        this.modifieds = data.filter(isModifiedEntry).map(getEntryPath);
    }
    info() {
        return info(this.dir);
    }
    log() {
        return log(this.dir);
    }
    resolve() {
        return resolve(this.conflicts, this.dir);
    }
    add() {
        return add(this.adds, this.dir);
    }
    update() {
        return update(this.dir);
    }
    del() {
        var items = this.deleteds.concat(this.missings);
        return del(items, this.dir);
    }
    commit(msg) {
        if (!this.hasChanges) {
            return;
        }
        return commit(msg, this.dir);
    }
    merge(revisions) {
        return merge(revisions, this.dir);
    }
}
exports.SVN = SVN;
var StatusType;
(function (StatusType) {
    StatusType[StatusType["unversioned"] = 0] = "unversioned";
    StatusType[StatusType["deleted"] = 1] = "deleted";
    StatusType[StatusType["missing"] = 2] = "missing";
    StatusType[StatusType["modified"] = 3] = "modified";
})(StatusType || (StatusType = {}));
class StatusTarget {
    constructor(path) {
        this.path = path;
    }
}
class Entry {
}
async function status(cwd, paths) {
    var data = await execute('status', {
        xml: true,
        cwd,
        params: paths
    });
    var items = data.target;
    if (!Array.isArray(items)) {
        items = [items];
    }
    var sts = items.map(target => {
        var ret = new StatusTarget(target.$.path);
        var entries = target.entry;
        if (entries) {
            if (!Array.isArray(entries)) {
                entries = [entries];
            }
            ret.entries = entries.map((item) => {
                var s = item['wc-status'];
                var data = {
                    type: s.$.item,
                    path: item.$.path,
                    revision: +s.$.revision,
                    hasConflict: !!s.$['tree-conflicted']
                };
                if (s.commit) {
                    data.commit = {
                        revision: +s.commit.$.revision,
                        author: s.commit.author,
                        date: s.commit.date
                    };
                }
                return data;
            });
        }
        return ret;
    });
    return sts;
}
exports.status = status;
function resolve(cwd, files, accept = 'mine-full') {
    return execute('resolve', {
        params: files,
        accept,
        cwd
    });
}
exports.resolve = resolve;
function add(cwd, paths) {
    return execute('add', {
        params: paths,
        cwd
    });
}
exports.add = add;
function update(cwd, dirs) {
    return execute('update', {
        accept: 'mine-full',
        cwd,
        params: dirs
    });
}
exports.update = update;
function del(cwd, paths) {
    return execute('delete', {
        params: paths,
        cwd
    });
}
exports.del = del;
function commit(cwd, msg = '~~~代码更新~~~', files) {
    var params = [`-m "${msg}"`, ...files];
    return execute('commit', {
        params,
        cwd
    });
}
exports.commit = commit;
function merge(cwd, url, revisions) {
    var params;
    if (typeof url === 'string') {
        params = ['-c', revisions.join(','), url, '.'];
    }
    else {
        url.push('.');
        params = url;
    }
    return execute('merge', {
        params,
        cwd
    });
}
exports.merge = merge;
var pnames = ['trunk', 'branches', 'tags'];
function getProjectDir(url, projectName) {
    var i = 0;
    if (projectName) {
        i = url.indexOf('/' + projectName + '/') + projectName.length + 1;
    }
    else {
        for (let name of pnames) {
            i = url.indexOf('/' + name + '/');
            if (i > -1) {
                break;
            }
        }
    }
    var dir = url.substring(0, i);
    return dir;
}
exports.getProjectDir = getProjectDir;
class Commit {
}
function info(urls) {
    if (!Array.isArray(urls)) {
        urls = [urls];
    }
    return execute('info', {
        params: urls,
        xml: true
    }).then((data) => {
        var entries = data.entry;
        if (!Array.isArray(entries)) {
            entries = [entries];
        }
        return entries.map((item => {
            var ret = {
                path: item.$.path,
                revision: +item.$.revision,
                url: item.url,
                relativeUrl: item['relative-url'],
                repository: {
                    root: item.repository.root,
                    uuid: item.repository.uuid
                },
                wcInfo: {
                    wcrootAbspath: item['wc-info']['wcroot-abspath'],
                    schedule: item['wc-info'].schedule,
                    depth: item['wc-info'].depth
                }
            };
            if (item.commit) {
                ret.commit = {
                    revision: +item.commit.$.revision,
                    author: item.commit.author,
                    date: item.commit.date
                };
            }
            return ret;
        }));
    });
}
exports.info = info;
function ls(urls) {
    if (!Array.isArray(urls)) {
        urls = [urls];
    }
    return execute('list', {
        params: urls,
        xml: true
    }).then((data) => {
        var list = data.list;
        if (!Array.isArray(list)) {
            list = [list];
        }
        return list.map((item) => {
            var entries = item.entry;
            if (!Array.isArray(entries)) {
                entries = [entries];
            }
            return {
                path: item.$.path,
                files: entries.map(entry => {
                    var ret = {
                        name: entry.name,
                        fullPath: item.$.path + '/' + item.name,
                        type: entry.$.kind
                    };
                    if (entry.commit) {
                        ret.commit = {
                            revision: +entry.commit.$.revision,
                            author: entry.commit.author,
                            date: entry.commit.date
                        };
                    }
                    return ret;
                })
            };
        });
    });
}
exports.ls = ls;
class LogEntry extends Commit {
}
function log(url, limit) {
    var params = [url];
    if (limit) {
        params.push(`-l ${limit}`);
    }
    return execute('log', {
        params,
        xml: true
    }).then((data) => {
        var logentries = data.logentry;
        if (!Array.isArray(logentries)) {
            logentries = [];
        }
        return logentries.map((entry) => ({
            revision: entry.$.revision,
            author: entry.author,
            date: entry.date,
            msg: entry.msg
        }));
    });
}
exports.log = log;
function getBranches(url, projectName) {
    return ls(getProjectDir(url, projectName) + '/branches');
}
exports.getBranches = getBranches;
function getTags(url, projectName) {
    return ls(getProjectDir(url, projectName) + '/tags');
}
exports.getTags = getTags;
async function getTrunks(url, projectName) {
    var items = await ls(getProjectDir(url, projectName));
    return items.filter((item) => !['branches', 'tags'].includes(item.name));
}
exports.getTrunks = getTrunks;
