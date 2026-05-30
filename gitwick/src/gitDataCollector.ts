import { execFile } from 'child_process';
import { CommitRecord } from './types';

/**
 * Collects commit history from a Git repository and computes cumulative LOC.
 */
export class GitDataCollector {
  constructor(private repoPath: string) {}

  /** Run git and return stdout as string */
  private execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd: this.repoPath,
        maxBuffer: 50 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) {
          const detail = stderr ? stderr.trim() : err.message;
          reject(new Error(`git ${args[0]} failed: ${detail}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /** Parse git log --shortstat output into CommitRecord[] */
  parseGitLog(output: string, limit: number = 10000): CommitRecord[] {
    const records: CommitRecord[] = [];
    const lines = output.split('\n');
    let i = 0;

    while (i < lines.length && records.length < limit) {
      const line = lines[i].trim();

      // Match hash + timestamp line: "abc1234 1717027200"
      const headerMatch = line.match(/^([0-9a-f]{7,40})\s+(\d+)$/);
      if (headerMatch) {
        const hash = headerMatch[1];
        const timestamp = parseInt(headerMatch[2], 10);

        let insertions = 0;
        let deletions = 0;

        // Check next lines for shortstat
        // Pattern: "X files changed, Y insertions(+), Z deletions(-)"
        // or just: "Y insertions(+), Z deletions(-)"
        for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
          const statLine = lines[j].trim();
          const insMatch = statLine.match(/(\d+)\s+insertions?\(\+\)/);
          const delMatch = statLine.match(/(\d+)\s+deletions?\(-\)/);
          if (insMatch) insertions = parseInt(insMatch[1], 10);
          if (delMatch) deletions = parseInt(delMatch[1], 10);
          if (insMatch || delMatch) break;
        }

        records.push({ hash, timestamp, insertions, deletions });
      }
      i++;
    }

    return records;
  }

  /** Collect all commit records and compute cumulative LOC sequence */
  async collect(limit: number = 10000): Promise<CommitRecord[]> {
    const output = await this.execGit([
      'log',
      '--all',
      '--reverse',
      '--format=%H %at',
      '--shortstat',
      '--no-merges',
    ]);

    const records = this.parseGitLog(output, limit);
    return records;
  }

  /** Get the repository name from the path */
  getRepoName(): string {
    const parts = this.repoPath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  /** Check if the given path is inside a git repository */
  static async isGitRepo(repoPath: string): Promise<boolean> {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['rev-parse', '--git-dir'], {
          cwd: repoPath,
        }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return true;
    } catch {
      return false;
    }
  }
}
