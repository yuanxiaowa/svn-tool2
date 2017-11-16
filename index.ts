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

function rStream(stream: Readable, isBuffer?: boolean):Promise<Buffer|string> {
  return new Promise((resolve ,reject) => {
    var datas: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => {
      datas.push(chunk);
    });
    stream.on('end', () => {
      if (isBuffer) {
        resolve(Buffer.concat(datas));
      } else {
        resolve(datas.join(''));
      }
    });
    stream.on('error', reject);
  })
}

async function execute(name: string, args: any = {}) {
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
  var [a, b] = await Promise.all([rStream(ps.stdout), rStream(ps.stderr)]);
  var v = a || b;
  if (v) {
    if (args.xml) {
      return xmlToJSON(<string>v);
    }
  }
  return v;
}

var getEntryPath = (item: any): string => item.path;
var isType = (type: string) => (item: any) => item.type === type;
var isDeletedEntry = isType('deleted');
var isNewEntry = isType('unversioned');
var isMissingEntry = isType('missing');
var isModifiedEntry = isType('modified');
var isConflictEntry = (item: any) => item.hasConflict;

export class SVN {
  adds: string[]
  deleteds: string[]
  conflicts: string[]
  missings: string[]
  modifieds: string[]
  hasChanges: Boolean
  constructor(public dir: string) { }
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
  commit(msg: string) {
    if (!this.hasChanges) {
      return;
    }
    return commit(msg, this.dir);
  }
  merge(revisions: string[]) {
    return merge(revisions, this.dir);
  }
}

enum StatusType {
  unversioned,
  deleted,
  missing,
  modified
}
interface StatusItem {
  type: StatusType
  path: string
  revision: number
  hasConflict: boolean
  commit?: {
    revision: number
    author: string
    date: string
  }
}
export async function status(cwd: string) {
  var data: any = await execute('status', {
    xml: true,
    cwd
  });
  var target = data.target;
  var ret: StatusItem[] = [];
  if (target.entry) {
    let entry: any[] = target.entry;
    if (!Array.isArray(entry)) {
      entry = [entry];
    }
    ret = entry.map(item => {
      var s = item['wc-status'];
      var data: StatusItem = {
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

export function resolve(items: string[], cwd: string) {
  if (items.length > 0) {
    return execute('resolve', {
      params: items,
      accept: 'mine-full',
      cwd
    });
  }
}

export function add(items: string[], cwd: string) {
  return execute('add', {
    params: items,
    cwd
  });
}

export function update(cwd: string) {
  return execute('update', {
    accept: 'mine-full',
    cwd
  });
}

export function del(items: string[], cwd: string) {
  if (items.length > 0) {
    return execute('delete', {
      params: items,
      cwd
    })
  }
}

export function commit(msg: string = '~~~代码更新~~~', cwd: string, files?: string[]) {
  var params = [`-m "${msg}"`];
  if (files && files.length > 0) {
    params.push(...files);
  }
  return execute('commit', {
    params,
    cwd
  });
}

export function merge(revisions: string[], cwd: string) {
  return execute('merge', {
    params: revisions,
    cwd
  })
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

export function log(url: string, limit?:number) {
  var params = [url];
  if (limit) {
    params.push(`-l ${limit}`);
  }
  return execute('log', {
    params,
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