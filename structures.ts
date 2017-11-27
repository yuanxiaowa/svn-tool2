
export class StatusTarget {
  constructor(public path: string) { }
  entries?: Entry[]
}
export class Entry {
  type: 'unversioned' | 'deleted' | 'missing' | 'modified'
  path: string
  revision: number
  hasConflict: boolean
  commit?: Commit
}
export class Commit {
  revision: number
  author: string
  date: string
}
export interface InfoEntry {
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
export interface LsFile {
  name: string
  fullPath: string
  type: 'file' | 'dir'
  commit?: Commit
}
export interface Ls {
  path: string
  files: LsFile[]
}

export interface LogPath {
  kind: string
  action: string
  path: string
}
export class LogEntry extends Commit {
  msg: string
  paths: LogPath[]
}
