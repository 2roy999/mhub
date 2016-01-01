/**
 * MHub server (mserver)
 *
 * Makes MHub pubsub Nodes available through WebSockets.
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import * as express from "express";
import * as http from "http";
import * as yargs from "yargs";
import * as path from "path";
import * as fs from "fs";
import * as pubsub from "./pubsub";
import SocketHub from "./SocketHub";
import Message from "./Message";

import log from "./log";

var args = yargs
	.usage("$0 [-c <config_file>]")
	.help("help")
	.alias("h", "help")
	.option("c", {
		type: "string",
		alias: "config",
		description: "Filename of config, uses mhub's server.conf.json by default"
	})
	.argv;

function die(...args: any[]): void {
	console.error.apply(this, args);
	process.exit(1);
}

var configFile: string;
if (!args.config) {
	configFile = path.resolve(__dirname, "../../server.conf.json");
} else {
	configFile = path.resolve(args.config);
}
console.log("Using config file " + configFile);
var config = JSON.parse(fs.readFileSync(configFile, "utf8"));

var app = express();

//app.use("/", express.static(__dirname + "/static"));

var server = http.createServer(app);
server.listen(config.port, (): void => {
	console.log("Listening on " + config.port);
});
server.on("error", (e: Error): void => {
	die("Webserver error:", e);
});

var hub = new SocketHub(server);

config.nodes.forEach((nodeName: string): void => {
	var node = new pubsub.Node(nodeName);
	hub.add(node);
});

interface Binding {
	from: string;
	to: string;
	pattern?: string;
}

config.bindings.forEach((binding: Binding): void => {
	var from = hub.find(binding.from);
	if (!from) {
		throw new Error("Unknown node '" + binding.from + "'");
	}
	var to = hub.find(binding.to);
	if (!to) {
		throw new Error("Unknown node '" + binding.to + "'");
	}
	from.bind(to, binding.pattern);
});

class PingResponder implements pubsub.Destination {
	constructor(public name: string, private pingNode: pubsub.Node) {
		this.pingNode.bind(this, "ping:request");
	}

	send(message: Message): void {
		log.push("-> %s", this.name, message.topic);
		this.pingNode.send(new Message("ping:response", message.data));
		log.pop();
	}
}

var testNode = hub.find("test");
if (testNode) {
	// Automatically send blibs when the test node is configured, useful for testing
	var blibCount = 0;
	setInterval((): void => {
		testNode.send(new Message("blib", blibCount++));
	}, 5000);

	// Automatically respond to pings when a ping node is configured, useful for testing
	/* tslint:disable:no-unused-variable */
	var pingResponder = new PingResponder("pong", testNode);
	/* tslint:enable:no-unused-variable */
}
