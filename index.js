"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-ignore
const xml2js_1 = require("xml2js");
const child_process_1 = require("child_process");
const structures_1 = require("./structures");
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
    if ('params' in args) {
        if (args.params != null) {
            params.push(...args.params);
        }
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
        throw new Error(b);
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
        return resolve(this.dir, this.conflicts);
    }
    add() {
        return add(this.dir, this.adds);
    }
    update() {
        return update(this.dir);
    }
    del() {
        var items = this.deleteds.concat(this.missings);
        return del(this.dir, items);
    }
    commit(msg) {
        if (!this.hasChanges) {
            return;
        }
        return commit(this.dir, ['.'], msg);
    }
    merge(urls, revisions) {
        // @ts-ignore
        return merge(this.dir, urls, revisions);
    }
}
exports.SVN = SVN;
function unixPath(path) {
    return path.replace(/\\/g, '/');
}
async function status(cwd, paths) {
    if (!paths) {
        paths = [cwd];
    }
    var data = await execute('status', {
        xml: true,
        params: paths
    });
    var items = data.target;
    if (!Array.isArray(items)) {
        items = [items];
    }
    var sts = items.map(target => {
        var ret = new structures_1.StatusTarget(target.$.path);
        var entries = target.entry;
        if (entries) {
            if (!Array.isArray(entries)) {
                entries = [entries];
            }
            ret.entries = entries.map((item) => {
                var s = item['wc-status'];
                var data = {
                    type: s.$.item,
                    path: unixPath(item.$.path.replace(ret.path, '')).substring(1),
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
        else {
            ret.entries = [];
        }
        ret.path = unixPath(ret.path);
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
function commit(cwd, files, msg = '~~~代码更新~~~') {
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
        params = ['-c', revisions.join(','), '--accept', 'theirs-full', url];
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
async function mergeinfo(cwd, url) {
    var str = await execute('mergeinfo', {
        params: ['--show-revs', 'merged', url],
        cwd
    });
    return str.trim().split(/\r?\n/).map(r => Number(r.substring(1)));
}
exports.mergeinfo = mergeinfo;
var pnames = ['branches', 'tags'];
function getProjectDir(url, projectName) {
    var i = 0;
    if (projectName) {
        i = url.indexOf('/' + projectName + '/') + projectName.length + 1;
    }
    else {
        i = url.indexOf('/trunk');
        if (i === -1) {
            for (let name of pnames) {
                i = url.indexOf('/' + name + '/');
                if (i > -1) {
                    break;
                }
            }
        }
    }
    var dir = url.substring(0, i);
    return dir;
}
exports.getProjectDir = getProjectDir;
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
                        fullPath: item.$.path + '/' + entry.name,
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
function log(url, limit) {
    var params = [url, '-v'];
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
        return logentries.map((entry) => {
            var paths = entry.paths.path;
            if (!Array.isArray(paths)) {
                paths = [paths];
            }
            return {
                revision: Number(entry.$.revision),
                author: entry.author,
                date: entry.date,
                msg: entry.msg,
                paths: paths.map(item => ({
                    kind: item.$.kind,
                    action: item.$.action,
                    path: item._
                }))
            };
        });
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
