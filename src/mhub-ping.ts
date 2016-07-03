/**
 * Commandline tool for determining latency.
 */

"use strict";

import * as yargs from "yargs";
import * as path from "path";
import MClient from "./client";
import Message from "./message";
import { TlsOptions, replaceKeyFiles } from "./tls";

var usage = [
	"Sends a message to the given node, waits for an answer, then sends the next etc.",
	"Prints the round-trip time for each message.",
	"",
	"Make sure you have the `test` node enabled in mhub-server, or provide your own",
	"routing to respond with `ping:response` to each `ping:request`",
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
	.option("insecure", {
		type: "boolean",
		description: "Disable server certificate validation, useful for testing using self-signed certificates",
	})
	.option("key", {
		type: "string",
		description: "Filename of TLS private key (in PEM format)",
	})
	.option("cert", {
		type: "string",
		description: "Filename of TLS certificate (in PEM format)",
	})
	.option("ca", {
		type: "string",
		description: "Filename of TLS certificate authority (in PEM format)",
	})
	.option("passphrase", {
		type: "string",
		description: "Passphrase for private key",
	})
	.option("pfx", {
		type: "string",
		description: "Filename of TLS private key, certificate and CA certificates " +
			"(in PFX or PKCS12 format). Mutually exclusive with --key, --cert and --ca.",
	})
	.option("crl", {
		type: "string",
		description: "Filename of certificate revocation list (in PEM format)",
	})
	.option("ciphers", {
		type: "string",
		description: "List of ciphers to use or exclude, separated by :",
	})
	.strict()
	.argv;

function createClient(): MClient {
	let tlsOptions: TlsOptions = {};
	tlsOptions.pfx = argv.pfx;
	tlsOptions.key = argv.key;
	tlsOptions.passphrase = argv.passphrase;
	tlsOptions.cert = argv.cert;
	tlsOptions.ca = argv.ca;
	tlsOptions.crl = argv.crl;
	tlsOptions.ciphers = argv.ciphers;
	tlsOptions.rejectUnauthorized = !argv.insecure;
	replaceKeyFiles(tlsOptions, process.cwd());
	return new MClient(argv.socket, tlsOptions);
}

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

var client = createClient();
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
