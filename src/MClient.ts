/**
 * MHub client library.
 */

"use strict";

import * as assert from "assert";
import * as events from "events";
import * as ws from "ws";
import Message from "./Message";

const MAX_SEQ = 65536;

interface Resolver<T> {
	(v: T|PromiseLike<T>): void;
}

interface VoidResolver extends Resolver<void> {
	(v?: PromiseLike<void>): void;
}

interface RawMessage {
	type: string;
	seq?: number;
}

interface SubscribeMessage extends RawMessage {
	node: string;
	pattern: string;
	id: string;
}

interface PublishMessage extends RawMessage {
	node: string;
	topic: string;
	data: any;
	headers: { [header: string]: string; };
	subscription: string;
}

interface ErrorMessage extends RawMessage {
	message: string;
}

interface SubAckMessage extends RawMessage {
}

/**
 * FLL Message Server client.
 *
 * Allows subscribing and publishing to MServer nodes.
 *
 * @event open() Emitted when connection was established.
 * @event close() Emitted when connection was closed.
 * @event error(e: Error) Emitted when there was a connection, server or protocol error.
 * @event message(m: Message) Emitted when message was received (due to subscription).
 */
class MClient extends events.EventEmitter {
	url: string;
	socket: ws = null;

	private _transactions: { [seqNo: number]: Resolver<RawMessage> } = {};
	private _seqNo = 0;

	/**
	 * Create new connection to MServer.
	 * @param url Websocket URL of MServer, e.g. ws://localhost:13900
	 */
	constructor(url: string) {
		super();
		this.url = url;
		this.connect();
	}

	/**
	 * Connect to the MServer.
	 * If connection is already active or pending, this is a no-op.
	 * Note: a connection is already initiated when the constructor is called.
	 */
	connect(): void {
		if (this.socket) {
			return;
		}

		this.socket = new ws(this.url);
		this.socket.on("error", (e: any): void => { this._handleSocketError(e); });
		this.socket.on("open", (): void => { this._handleSocketOpen(); });
		this.socket.on("close", (): void => { this._handleSocketClose(); });
		this.socket.on("message", (data: string): void => {
			try {
				var decoded: RawMessage = JSON.parse(data);
				switch (decoded.type) {
					case "message":
						let msgDec = <PublishMessage>decoded;
						this.emit("message", new Message(msgDec.topic, msgDec.data, msgDec.headers), msgDec.subscription);
						break;
					case "error":
						let errDec = <ErrorMessage>decoded;
						let err = new Error("server error: " + errDec.message);
						this._release(errDec.seq, err, decoded);
						this.emit("error", err);
						break;
					case "suback":
					case "puback":
						this._release(decoded.seq, undefined, decoded);
						break;
					default:
						throw new Error("unknown message type: " + decoded.type);
				}
			} catch (e) {
				this.emit("error", new Error("message decode error: " + e.message));
			}
		});
	}

	/**
	 * Disconnect from MServer.
	 * If already disconnected, this becomes a no-op.
	 *
	 * Note: any existing subscriptions will be lost.
	 */
	close(): void {
		if (this.socket) {
			this.socket.close();
			this.socket = null;
		}
		let closedRejection = Promise.reject(new Error("connection closed"));
		for (let t in this._transactions) {
			if (!this._transactions.hasOwnProperty(t)) {
				continue;
			}
			this._transactions[t](closedRejection);
		}
		this._transactions = {};
	}

	/**
	 * Subscribe to a node. Emits the "message" event when a message is received for this
	 * subscription.
	 *
	 * @param nodeName Name of node in MServer to subscribe to (e.g. "default")
	 * @param pattern  Optional pattern glob (e.g. "namespace:*"), matches all messages if not given
	 * @param id       Optional subscription ID sent back with all matching messages
	 */
	subscribe(nodeName: string, pattern?: string, id?: string): Promise<void> {
		return this._send(<SubscribeMessage>{
			type: "subscribe",
			node: nodeName,
			pattern: pattern,
			id: id
		}).then(() => undefined);
	}

	/**
	 * Publish message to a node.
	 *
	 * @param nodeName Name of node in MServer to publish to (e.g. "default")
	 * @param topic Message topic
	 * @param data  Message data
	 * @param headers Message headers
	 */
	publish(nodeName: string, topic: string, data?: any, headers?: { [name: string]: string }): Promise<void>;
	/**
	 * Publish message to a node.
	 *
	 * @param nodeName Name of node in MServer to publish to (e.g. "default")
	 * @param message Message object
	 */
	publish(nodeName: string, message: Message): Promise<void>;
	// Implementation
	publish(nodeName: string, ...args: any[]): Promise<void> {
		if (typeof args[0] === "object") {
			var message: Message = args[0];
			return this._send(<PublishMessage>{
				type: "publish",
				node: nodeName,
				topic: message.topic,
				data: message.data,
				headers: message.headers
			}).then(() => undefined);
		} else {
			return this._send(<PublishMessage>{
				type: "publish",
				node: nodeName,
				topic: args[0],
				data: args[1],
				headers: args[2]
			}).then(() => undefined);
		}
	}

	private _handleSocketOpen(): void {
		this.emit("open");
	}

	private _handleSocketError(err: any): void {
		if (!(err instanceof Error)) {
			err = new Error("WebSocket error: " + err);
		}
		this.emit("error", err);
	}

	private _handleSocketClose(): void {
		// Emit `close` event when socket is closed (i.e. not just when
		// `close()` is called without being connected yet)
		this.emit("close");
		// Discard socket, abort pending transactions
		this.close();
	}

	private _send(msg: RawMessage): Promise<RawMessage> {
		return new Promise<RawMessage>((resolve: () => void, reject: (err: Error) => void) => {
			msg.seq = this._nextSeq();
			this._transactions[msg.seq] = resolve;
			if (!this.socket) {
				var e = new Error("not connected");
				this.emit("error", e);
				throw e;
			}
			this.socket.send(JSON.stringify(msg), (err?: Error) => {
				if (err) {
					this._release(msg.seq, err);
					return reject(err);
				}
			});
		});
	}

	private _release(seqNr: number, err: Error|void, msg?: RawMessage): void {
		let resolver = this._transactions[seqNr];
		if (!resolver) {
			return;
		}
		if (err) {
			resolver(Promise.reject(err));
		} else {
			resolver(msg);
		}
	}

	private _nextSeq(): number {
		let maxIteration = MAX_SEQ;
		while (--maxIteration > 0 && this._transactions[this._seqNo]) {
			this._seqNo++;
		}
		assert(maxIteration, "out of sequence numbers");
		let result = this._seqNo;
		this._seqNo = (this._seqNo + 1) % MAX_SEQ;
		return result;
	}
}

export default MClient;
