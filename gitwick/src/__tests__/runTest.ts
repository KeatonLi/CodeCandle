import * as path from 'path';
import Mocha from 'mocha';
import * as glob from 'glob';

async function main(): Promise<void> {
  try {
    const mocha = new Mocha({ ui: 'tdd', color: true });
    const testsRoot = path.resolve(__dirname);

    const files = glob.sync('**/**.test.js', { cwd: testsRoot });

    if (files.length === 0) {
      console.error('No test files found');
      process.exit(1);
    }

    files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

    const failures = await new Promise<number>(resolve => {
      mocha.run(resolve);
    });

    if (failures > 0) {
      console.error(`${failures} test(s) failed.`);
      process.exit(1);
    }

    console.log(`\nAll tests passed.`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
