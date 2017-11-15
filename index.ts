// @ts-ignore
import { parseString } from 'xml2js'
import { spawn } from 'child_process'
import { Readable } from 'stream'

function xmlToJSON(xml: string) {
  return new Promise((resolve, reject) => {
    parseString(xml, {
      explicitRoot: false,
      explicitArray: false
    }, (err: any, result: any) => {
      if (err) {
        return reject(err);
      }
      resolve(result);
    });
  })
}

function rStream(stream: Readable, isBuffer: boolean, cb: Function) {
  var datas: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    datas.push(chunk);
  });
  stream.on('end', () => {
    if (isBuffer) {
      cb(Buffer.concat(datas));
    } else {
      cb(datas.join(''));
    }
  });
}

function execute(name: string, args: any = {}) {
  var params = [name, '--non-interactive', '--trust-server-cert'];
  var opts: any = {};
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
    } else {
      params.push('--' + key);
    }
    if (v !== true) {
      params.push(v);
    }
  });
  var ps = spawn('svn', params, opts);
  return new Promise((resolve, reject) => {
    rStream(ps.stdout, false, (data: string) => {
      if (args.xml) {
        return xmlToJSON(data).then(resolve);
      }
      resolve(data);
    });
    rStream(ps.stderr, false, reject);
  })
}

var getEntryPath = (item: any) => item.$.path;
var isType = (type: string) => (item: any) => item['wc-status'].$.item === type;
var isDeletedEntry = isType('deleted');
var isNewEntry = isType('unversioned');
var isMissingEntry = isType('missing');
var isModifiedEntry = isType('modified');
var isConflictEntry = (item: any) => item['wc-status'].$['tree-conflicted'] === 'true';

export class SVN {
  adds: string[] = []
  deleteds: string[] = []
  conflicts: string[] = []
  missings: string[] = []
  modifieds: string[] = []
  hasChanges: Boolean
  constructor(public dir: string) { }
  getOpts(opts: any = {}) {
    opts.cwd = this.dir
    return opts;
  }
  async status() {
    var data: any = await execute('status', this.getOpts({
      xml: true
    }));
    var target = data.target;
    if (target.entry) {
      let entry: any[] = target.entry;
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
    }))
  }
  commit(msg: string = '~~~代码更新~~~') {
    if (!this.hasChanges) {
      return;
    }
    return execute('commit', this.getOpts({
      params: [`-m "${msg}"`]
    }));
  }
  merge(revisions: string[]) {
    return execute('merge', this.getOpts({
      params: revisions
    }))
  }
}

var pnames = ['trunk', 'branches', 'tags'];
export function getProjectDir(url: string, projectName?: string) {
  var i = 0;
  if (projectName) {
    i = url.indexOf('/' + projectName + '/') + projectName.length + 1;
  } else {
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

export function info(url: string) {
  return execute('info', {
    params: [url],
    xml: true
  }).then((data: any) => data.entry)
}

export function ls(url: string) {
  return execute('list', {
    params: [url],
    xml: true
  }).then((data: any) => data.list.entry.map((item: any) => ({
    name: item.name,
    url: data.list.$.path + '/' + item.name
  })));
}

export function log(url: string) {
  return execute('log', {
    params: [url],
    xml: true
  }).then((data: any) => data.logentry.map((entry: any) => ({
    revision: entry.$.revision,
    author: entry.author,
    date: entry.date,
    msg: entry.msg
  })))
}

export function getBranches(url: string, projectName?: string) {
  return ls(getProjectDir(url, projectName) + '/branches');
}

export function getTags(url: string, projectName?: string) {
  return ls(getProjectDir(url, projectName) + '/tags');
}

export async function getTrunks(url: string, projectName?: string) {
  var items = await ls(getProjectDir(url, projectName));
  return items.filter((item: any) => !['branches', 'tags'].includes(item.name));
}