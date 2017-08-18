import assert = require("assert");
import { exec } from "child_process";
import { pathExists, readdir } from "fs-extra";
import { join as joinPaths } from "path";

const pathToDtsLint = require.resolve("dtslint");

if (module.parent === null) { // tslint:disable-line no-null-keyword
	let onlyLint = false;
	let nProcesses = 8; // tslint:disable-line no-magic-numbers
	const { argv } = process;
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "--onlyLint": {
				onlyLint = true;
				break;
			}
			case "--nProcesses": {
				i++;
				assert(i < argv.length);
				nProcesses = Number.parseInt(argv[i]);
				assert(!Number.isNaN(nProcesses));
				break;
			}
			default:
				throw new Error(`Unexpected arg ${arg}`);
		}
	}

	main(nProcesses, onlyLint)
		.then(code => { process.exit(code); })
		.catch(err => { console.error(err); });
}

async function main(nProcesses: number, onlyLint: boolean): Promise<number> {
	const installError = await run(/*cwd*/ undefined, pathToDtsLint, "--installAll");
	if (installError !== undefined) {
		return 1;
	}

	const dtDir = joinPaths(process.cwd(), "..", "DefinitelyTyped");
	if (!(await pathExists(dtDir))) {
		throw new Error("Should be run in a directory next to DefinitelyTyped");
	}

	const typesDir = joinPaths(dtDir, "types");
	const packageNames = await readdir(typesDir);

	const packageToErrors = await nAtATime(nProcesses, packageNames, async packageName =>
		({ packageName, error: await testPackage(joinPaths(typesDir, packageName), onlyLint) }));
	const errors = packageToErrors.filter(({ error }) => error !== undefined) as
		Array<{ packageName: string, error: string }>;

	if (errors.length === 0) {
		return 0;
	}

	for (const { packageName, error } of errors) {
		console.error(packageName);
		console.error(`  ${error.replace(/\n/g, "\n  ")}`);
	}

	console.error(`Failing packages: ${errors.map(e => e.packageName).join(", ")}`);

	return 1;
}

async function testPackage(packagePath: string, onlyLint: boolean): Promise<string | undefined> {
	const shouldLint = await pathExists(joinPaths(packagePath, "tslint.json"));
	if (onlyLint && !shouldLint) {
		return undefined;
	}
	const args = shouldLint ? [] : ["--noLint"];
	return run(packagePath, pathToDtsLint, ...args);
}

function run(cwd: string | undefined, cmd: string, ...args: string[]): Promise<string | undefined> {
	const nodeCmd = `node ${cmd} ${args.join(" ")}`;
	return new Promise<string | undefined>(resolve => {
		exec(nodeCmd, { encoding: "utf8", cwd }, (error, stdout, stderr) => {
			stdout = stdout.trim();
			stderr = stderr.trim();
			if (stdout !== "") {
				console.log(stdout);
			}
			if (stderr !== "") {
				console.error(stderr);
			}
			// tslint:disable-next-line no-null-keyword
			resolve(error === null ? undefined : `${error.message}\n${stdout}\n${stderr}`);
		});
	});
}

async function nAtATime<T, U>(n: number, inputs: ReadonlyArray<T>, use: (t: T) => Promise<U>): Promise<U[]> {
	const results = new Array(inputs.length);
	let nextIndex = 0;
	await Promise.all(initArray(n, async () => {
		while (nextIndex !== inputs.length) {
			const index = nextIndex;
			nextIndex++;
			const output = await use(inputs[index]);
			results[index] = output;
		}
	}));
	return results;
}

function initArray<T>(length: number, makeElement: () => T): T[] {
	const arr = new Array(length);
	for (let i = 0; i < length; i++) {
		arr[i] = makeElement();
	}
	return arr;
}
