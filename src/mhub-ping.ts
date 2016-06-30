/**
 * Commandline tool for determining latency.
 */

"use strict";

import * as yargs from "yargs";
import * as path from "path";
import MClient from "./client";
import Message from "./message";

var usage = [
	"$0 [-s <host>[:<port>]] [-n <nodename>] [-d <json_data>] [-h <json_headers>] [-c <count>]",
].join("\n");

function die(...args: any[]): void {
	console.error.apply(this, args);
	process.exit(1);
}

var argv = yargs
	.usage(usage)
	.help("help")
	// tslint:disable-next-line:no-require-imports
	.version(() => require(path.resolve(__dirname, "../../package.json")).version)
	.alias("v", "version")
	.option("s", {
		type: "string",
		alias: "socket",
		description: "WebSocket to connect to",
		default: "localhost:13900",
	})
	.option("n", {
		type: "string",
		alias: "node",
		description: "Node to subscribe/publish to",
		default: "test",
	})
	.option("d", {
		type: "string",
		alias: "data",
		description: "Optional message data as JSON object, e.g. '\"a string\"' or '{ \"foo\": \"bar\" }'",
	})
	.option("h", {
		type: "string",
		alias: "headers",
		description: "Optional message headers as JSON object, e.g. '{ \"my-header\": \"foo\" }'",
	})
	.option("c", {
		type: "number",
		alias: "count",
		description: "Number of pings to send",
		default: 10,
	})
	.argv;

var data: any;
try {
	data = argv.data && JSON.parse(argv.data);
} catch (e) {
	console.error("Error parsing message data as JSON: " + e.message);
	die(
		"Hint: if you're passing a string, make sure to put double-quotes around it, " +
		"and escape these quotes for your shell with single-quotes, e.g.: '\"my string\"'"
	);
}

var headers: any;
try {
	headers = argv.headers && JSON.parse(argv.headers);
} catch (e) {
	die("Error parsing message headers as JSON: " + e.message);
}

var pingCount = argv.count;

var client = new MClient("ws://" + argv.socket);
client.on("error", (e: Error): void => {
	die("Socket error:", e);
});
client.on("open", (): void => {
	client.subscribe(argv.node, "ping:response");
	ping();
});
client.on("message", (msg: Message): void => {
	var reply = JSON.stringify(msg.data);
	if (argv.data === reply) {
		console.timeEnd("pong"); // tslint:disable-line:no-console
		if (pingCount > 0) {
			ping();
		} else {
			client.close();
		}
	}
});

function ping(): void {
	pingCount--;
	console.time("pong"); // tslint:disable-line:no-console
	client.publish(argv.node, "ping:request", data, headers);
}
