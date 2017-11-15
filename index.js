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
function rStream(stream, isBuffer, cb) {
    var datas = [];
    stream.on('data', (chunk) => {
        datas.push(chunk);
    });
    stream.on('end', () => {
        if (isBuffer) {
            cb(Buffer.concat(datas));
        }
        else {
            cb(datas.join(''));
        }
    });
}
function execute(name, args = {}) {
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
    return new Promise((resolve, reject) => {
        rStream(ps.stdout, false, (data) => {
            if (args.xml) {
                return xmlToJSON(data).then(resolve);
            }
            resolve(data);
        });
        rStream(ps.stderr, false, reject);
    });
}
var getEntryPath = (item) => item.$.path;
var isType = (type) => (item) => item['wc-status'].$.item === type;
var isDeletedEntry = isType('deleted');
var isNewEntry = isType('unversioned');
var isMissingEntry = isType('missing');
var isModifiedEntry = isType('modified');
var isConflictEntry = (item) => item['wc-status'].$['tree-conflicted'] === 'true';
class SVN {
    constructor(dir) {
        this.dir = dir;
    }
    async status() {
        var data = await status(this.dir);
        this.hasChanges = data.hasChanges;
        this.conflicts = data.conflicts;
        this.deleteds = data.deleteds;
        this.adds = data.adds;
        this.missings = data.missings;
        this.modifieds = data.modifieds;
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
async function status(dir) {
    var data = await execute('status', {
        xml: true,
        dir
    });
    var target = data.target;
    var ret = {
        hasChanges: !!target.entry,
        conflicts: [],
        deleteds: [],
        adds: [],
        missings: [],
        modifieds: []
    };
    if (target.entry) {
        let entry = target.entry;
        if (!Array.isArray(entry)) {
            entry = [entry];
        }
        ret.conflicts = entry.map(isConflictEntry).map(getEntryPath);
        ret.deleteds = entry.map(isDeletedEntry).map(getEntryPath);
        ret.adds = entry.map(isNewEntry).map(getEntryPath);
        ret.missings = entry.map(isMissingEntry).map(getEntryPath);
        ret.modifieds = entry.map(isModifiedEntry).map(getEntryPath);
    }
    return ret;
}
exports.status = status;
function resolve(items, dir) {
    if (items.length > 0) {
        return execute('resolve', {
            params: items,
            accept: 'mine-full',
            dir
        });
    }
}
exports.resolve = resolve;
function add(items, dir) {
    return execute('add', {
        params: items,
        dir
    });
}
exports.add = add;
function update(dir) {
    return execute('update', {
        accept: 'mine-full',
        dir
    });
}
exports.update = update;
function del(items, dir) {
    if (items.length > 0) {
        return execute('delete', {
            params: items,
            dir
        });
    }
}
exports.del = del;
function commit(msg = '~~~代码更新~~~', dir) {
    return execute('commit', {
        params: [`-m "${msg}"`],
        dir
    });
}
exports.commit = commit;
function merge(revisions, dir) {
    return execute('merge', {
        params: revisions,
        dir
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
