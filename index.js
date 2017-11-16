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
    if (v) {
        if (args.xml) {
            return xmlToJSON(v);
        }
    }
    return v;
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
async function status(cwd) {
    var data = await execute('status', {
        xml: true,
        cwd
    });
    var target = data.target;
    var ret = [];
    if (target.entry) {
        let entry = target.entry;
        if (!Array.isArray(entry)) {
            entry = [entry];
        }
        ret = entry.map(item => {
            var s = item['wc-status'];
            var data = {
                type: s.$.item,
                path: item.$.path,
                revision: +s.$.revision,
                hasConflict: !!s.$['tree-conflicted']
            };
            if (s.commit) {
                data.commit = {
                    revision: s.commit.$.revision,
                    author: s.commit.author,
                    date: s.commit.date
                };
            }
            return data;
        });
    }
    return ret;
}
exports.status = status;
function resolve(items, cwd) {
    if (items.length > 0) {
        return execute('resolve', {
            params: items,
            accept: 'mine-full',
            cwd
        });
    }
}
exports.resolve = resolve;
function add(items, cwd) {
    return execute('add', {
        params: items,
        cwd
    });
}
exports.add = add;
function update(cwd) {
    return execute('update', {
        accept: 'mine-full',
        cwd
    });
}
exports.update = update;
function del(items, cwd) {
    if (items.length > 0) {
        return execute('delete', {
            params: items,
            cwd
        });
    }
}
exports.del = del;
function commit(msg = '~~~代码更新~~~', cwd) {
    return execute('commit', {
        params: [`-m "${msg}"`],
        cwd
    });
}
exports.commit = commit;
function merge(revisions, cwd) {
    return execute('merge', {
        params: revisions,
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
                i += name.length + 1;
                break;
            }
        }
    }
    var dir = url.substring(0, i);
    return dir;
}
exports.getProjectDir = getProjectDir;
function info(url) {
    return execute('info', {
        params: [url],
        xml: true
    }).then((data) => data.entry);
}
exports.info = info;
function ls(url) {
    return execute('list', {
        params: [url],
        xml: true
    }).then((data) => data.list.entry.map((item) => ({
        name: item.name,
        url: data.list.$.path + '/' + item.name
    })));
}
exports.ls = ls;
function log(url) {
    return execute('log', {
        params: [url],
        xml: true
    }).then((data) => data.logentry.map((entry) => ({
        revision: entry.$.revision,
        author: entry.author,
        date: entry.date,
        msg: entry.msg
    })));
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
