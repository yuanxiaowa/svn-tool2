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
        this.adds = [];
        this.deleteds = [];
        this.conflicts = [];
        this.missings = [];
        this.modifieds = [];
    }
    getOpts(opts = {}) {
        opts.cwd = this.dir;
        return opts;
    }
    async status() {
        var data = await execute('status', this.getOpts({
            xml: true
        }));
        var target = data.target;
        if (target.entry) {
            let entry = target.entry;
            this.hasChanges = true;
            if (!Array.isArray(entry)) {
                entry = [entry];
            }
            this.conflicts = entry.map(isConflictEntry).map(getEntryPath);
            this.deleteds = entry.map(isDeletedEntry).map(getEntryPath);
            this.adds = entry.map(isNewEntry).map(getEntryPath);
            this.missings = entry.map(isMissingEntry).map(getEntryPath);
            this.modifieds = entry.map(isModifiedEntry).map(getEntryPath);
        }
    }
    info() {
        return info(this.dir);
    }
    log() {
        return log(this.dir);
    }
    resolve() {
        if (this.conflicts.length === 0) {
            return;
        }
        return execute('resolve', this.getOpts({
            params: this.conflicts,
            accept: 'mine-full'
        }));
    }
    add() {
        if (this.adds.length === 0) {
            return;
        }
        return execute('add', this.getOpts({
            params: this.adds
        }));
    }
    update() {
        return execute('update', this.getOpts({
            accept: 'mine-full'
        }));
    }
    del() {
        var items = this.deleteds.concat(this.missings);
        if (items.length === 0) {
            return;
        }
        return execute('delete', this.getOpts({
            params: items
        }));
    }
    commit(msg = '~~~代码更新~~~') {
        if (!this.hasChanges) {
            return;
        }
        return execute('commit', this.getOpts({
            params: [`-m "${msg}"`]
        }));
    }
    merge(revisions) {
        return execute('merge', this.getOpts({
            params: revisions
        }));
    }
}
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
