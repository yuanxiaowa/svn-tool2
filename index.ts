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

function rStream(stream: Readable, isBuffer?: boolean): Promise<Buffer | string> {
  return new Promise((resolve, reject) => {
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
  if (a) {
    if (args.xml) {
      return xmlToJSON(<string>a);
    }
  } else if (b) {
    throw b;
  }
  return a;
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
class StatusTarget {
  constructor(public path: string) { }
  entries?: Entry[]
}
class Entry {
  type: StatusType
  path: string
  revision: number
  hasConflict: boolean
  commit?: Commit
}
export async function status(cwd: string, paths?: string[]) {
  var data: any = await execute('status', {
    xml: true,
    cwd,
    params: paths
  });
  var items: any[] = data.target;
  if (!Array.isArray(items)) {
    items = [items];
  }
  var sts: StatusTarget[] = items.map(target => {
    var ret = new StatusTarget(target.$.path);
    var entries = target.entry;
    if (entries) {
      if (!Array.isArray(entries)) {
        entries = [entries]
      }
      ret.entries = entries.map((item: any) => {
        var s = item['wc-status'];
        var data: Entry = {
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
      })
    }
    return ret;
  });
  return sts
}

export function resolve(cwd: string, files: string[], accept = 'mine-full') {
  return execute('resolve', {
    params: files,
    accept,
    cwd
  });
}

export function add(cwd: string, paths: string[]) {
  return execute('add', {
    params: paths,
    cwd
  });
}

export function update(cwd: string): Promise<any>;
export function update(cwd: string, dirs: string[]): Promise<any>;
export function update(cwd: string, dirs?: string[]) {
  return execute('update', {
    accept: 'mine-full',
    cwd,
    params: dirs
  });
}

export function del(cwd: string, paths: string[]) {
  return execute('delete', {
    params: paths,
    cwd
  })
}

export function commit(cwd: string, msg: string = '~~~代码更新~~~', files: string[]) {
  var params = [`-m "${msg}"`, ...files];
  return execute('commit', {
    params,
    cwd
  });
}

export function merge(cwd: string, url: string, revisions: string[]): Promise<any>;
export function merge(cwd: string, urls: string[]): Promise<any>;
export function merge(cwd: string, url: string | string[], revisions?: string[]): Promise<any> {
  var params: string[];
  if (typeof url === 'string') {
    params = ['-c', (<string[]>revisions).join(','), url, '.'];
  } else {
    url.push('.');
    params = url;
  }
  return execute('merge', {
    params,
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
class Commit {
  revision: number
  author: string
  date: string
}
interface InfoEntry {
  path: string
  revision: number
  url: string
  relativeUrl: string
  repository: {
    root: string
    uuid: string
  }
  wcInfo: {
    wcrootAbspath: string
    schedule: string
    depth: string
  }
  commit?: Commit
}
export function info(url: string): Promise<InfoEntry[]>;
export function info(urls: string[]): Promise<InfoEntry[]>;
export function info(urls: (string | string[])) {
  if (!Array.isArray(urls)) {
    urls = [urls];
  }
  return execute('info', {
    params: urls,
    xml: true
  }).then((data: any) => {
    var entries = data.entry;
    if (!Array.isArray(entries)) {
      entries = [entries];
    }
    return (<any[]>entries).map((item => {
      var ret: InfoEntry = {
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
  })
}
interface LsFile {
  name: string
  fullPath: string
  type: 'file' | 'dir'
  commit?: Commit
}
interface Ls {
  path: string
  files: LsFile[]
}
export function ls(url: string): Promise<Ls[]>;
export function ls(urls: string[]): Promise<Ls[]>;
export function ls(urls: string | string[]) {
  if (!Array.isArray(urls)) {
    urls = [urls];
  }
  return execute('list', {
    params: urls,
    xml: true
  }).then((data: any) => {
    var list: any[] = data.list;
    if (!Array.isArray(list)) {
      list = [list];
    }
    return list.map((item: any) => {
      var entries: any[] = item.entry;
      if (!Array.isArray(entries)) {
        entries = [entries];
      }
      return {
        path: item.$.path,
        files: entries.map(entry => {
          var ret: LsFile = {
            name: entry.name,
            fullPath: item.$.path + '/' + item.name,
            type: entry.$.kind
          };
          if (entry.commit) {
            ret.commit = {
              revision: +entry.commit.$.revision,
              author: entry.commit.author,
              date: entry.commit.date
            }
          }
          return ret;
        })
      }
    });
  });
}

class LogEntry extends Commit {
  msg: string
}

export function log(url: string | string[], limit?: number) {
  var params = [url];
  if (limit) {
    params.push(`-l ${limit}`);
  }
  return execute('log', {
    params,
    xml: true
  }).then((data: any) => {
    var logentries: any[] = data.logentry;
    if (!Array.isArray(logentries)) {
      logentries = [];
    }
    return logentries.map((entry: any): LogEntry => ({
      revision: entry.$.revision,
      author: entry.author,
      date: entry.date,
      msg: entry.msg
    }))
  })
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