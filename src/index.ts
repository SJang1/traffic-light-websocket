import { DurableObject } from "cloudflare:workers";

interface UpdateRequest {
	status: 'red' | 'yellow' | 'green';
	distance_cm: number;
}

interface TrafficLight {
	id: number;
	distance_cm: number;
	status: string;
	last_updated: string;
}


// Helper function to validate individual traffic light data
function validateTrafficLightData(data: any): { isValid: boolean; error?: string } {
	if (!data) {
	  return { isValid: false, error: 'Data is required' };
	}
  
	let { status, distance_cm } = data;
  
	// Treat undefined distance_cm as -1
	if (distance_cm === undefined) {
	  distance_cm = -1;
	}
  
	if (status && !['red', 'yellow', 'green'].includes(status)) {
	  return { isValid: false, error: 'Invalid status. Must be red, yellow, or green.' };
	}
  
	if (distance_cm < -1 || typeof distance_cm !== 'number') {
	  return { isValid: false, error: 'distance_cm must be -1 or a non-negative number.' };
	}
  
	return { isValid: true };
}
/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run npm run dev in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run npm run deploy to publish your application
 *
 * Bind resources to your worker in wrangler.toml. After adding bindings, a type definition for the
 * Env object can be regenerated with npm run cf-typegen.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class TrafficLightDemo extends DurableObject {
	currentlyConnectedWebSockets: number;

	tramLight: string;
	tramDistanceCm: number;
	tramLastUpdate: string;

	carLight: string;
	carDistanceCm: number;
	carLastUpdate: string;

  
	constructor(ctx: DurableObjectState, env: Env) {
	  // This is reset whenever the constructor runs because
	  // regular WebSockets do not survive Durable Object resets.
	  //
	  // WebSockets accepted via the Hibernation API can survive
	  // a certain type of eviction, but we will not cover that here.
	  super(ctx, env);
	  this.currentlyConnectedWebSockets = 0;
	  this.tramLight = "red";
	  this.tramDistanceCm = -1;
	  this.tramLastUpdate = "2000-01-01T00:00:00Z";
	  this.carLight = "red";
	  this.carDistanceCm = -1;
	  this.carLastUpdate = "2000-01-01T00:00:00Z";

	  this.initializeState();

	}

	async initializeState() {
		const tramValue = await this.env.TrafficLightDemoKV.get("tram");
		if (tramValue) {
		  const data = JSON.parse(tramValue);
		  this.tramLight = data.status;
		  this.tramDistanceCm = data.distance_cm;
		  this.tramLastUpdate = data.last_updated;
		}
	
		const carValue = await this.env.TrafficLightDemoKV.get("car");
		if (carValue) {
		  const data = JSON.parse(carValue);
		  this.carLight = data.status;
		  this.carDistanceCm = data.distance_cm;
		  this.carLastUpdate = data.last_updated;
		}
	  }
	
	
  

	async getState(request: Request): Promise<Response> {

		let Tram: TrafficLight = {
		  id: 1,
		  status: this.tramLight,
		  distance_cm: this.tramDistanceCm,
		  last_updated: this.tramLastUpdate,
		};
		let Car: TrafficLight = {
			id: 2,
			status: this.carLight,
			distance_cm: this.carDistanceCm,
			last_updated: this.carLastUpdate,
		};


	  
		return new Response(JSON.stringify({ Tram, Car }), {
		  status: 200,
		  headers: { 'Content-Type': 'application/json' },
		});
	}
	async fetch(request: Request): Promise<Response> {
	  // Creates two ends of a WebSocket connection.
	  const webSocketPair = new WebSocketPair();
	  const [client, server] = Object.values(webSocketPair);
  
	  // Calling accept() tells the runtime that this WebSocket is to begin terminating
	  // request within the Durable Object. It has the effect of "accepting" the connection,
	  // and allowing the WebSocket to send and receive messages.
	  
	  this.ctx.acceptWebSocket(server);
  
	  this.currentlyConnectedWebSockets += 1;
	  /*
	  server.send(JSON.stringify({
		trafficLightData: {
		  id: 1,
		  status: this.tramLight,
		  distance_cm: this.tramDistanceCm,
		  last_updated: this.tramLastUpdate,
		},
		trafficLightData2: {
		  id: 2,
		  status: this.carLight,
		  distance_cm: this.carDistanceCm,
		  last_updated: this.carLastUpdate,
		},
	  }));
	  */
	  
	  // Function to broadcast updates to all connected clients
	  const broadcastUpdate = () => {
		const updateMessage = JSON.stringify({
		  connectedusers: this.ctx.getWebSockets().length,
		  "1": {
			id: 1,
			status: this.tramLight,
			distance_cm: this.tramDistanceCm,
			last_updated: this.tramLastUpdate,
		  },
		  "2": {
			id: 2,
			status: this.carLight,
			distance_cm: this.carDistanceCm,
			last_updated: this.carLastUpdate,
		  },
		});
		this.ctx.getWebSockets().forEach((ws) => {
			ws.send(updateMessage);
	  	});
	  };


	  // Call broadcastUpdate initially to send the first data
	  broadcastUpdate();

	  // Check updates every 0.1 seconds and if there is any change, broadcast it.
	  // If there is no changes, the client will not receive any updates.
  
	  return new Response(null, {
		status: 101,
		webSocket: client,
	  });
	}


	

	/*
	async stateChange(request: Request): Promise<Response> {
		let trafficLightData: TrafficLight = {
		  id: 1,
		  status: this.tramLight,
		  distance_cm: this.tramDistanceCm,
		  last_updated: this.tramLastUpdate,
		};
	  
		let trafficLightData2: TrafficLight = {
		  id: 2,
		  status: this.carLight,
		  distance_cm: this.carDistanceCm,
		  last_updated: this.carLastUpdate,
		};
	  
		return new Response(JSON.stringify({ trafficLightData, trafficLightData2 }), {
		  status: 200,
		  headers: { 'Content-Type': 'application/json' },
		});
	}
		*/

	async updateChange(request: Request): Promise<number> {
		let body: Record<string, UpdateRequest>;
	  
		try {
		  body = await request.json();
		} catch (e) {
		  return 400;
		}
	  
		const errors = [];
		const updates = [];
	  
		for (const id in body) {
		  const trafficLightData = body[id];
		  const validation = validateTrafficLightData(trafficLightData);
	  
		  if (!validation.isValid) {
			errors.push({ id, error: validation.error });
			continue;
		  }
	  
		  const { status, distance_cm } = trafficLightData;
		  const last_updated = new Date().toISOString();
	  
		  // Save to tram or car based on id
		  if (id === "1") {
			// Update tram data
			this.tramLight = status;
			this.tramDistanceCm = distance_cm;
			this.tramLastUpdate = last_updated;
		  } else if (id === "2") {
			// Update car data
			this.carLight = status;
			this.carDistanceCm = distance_cm;
			this.carLastUpdate = last_updated;
		  } else {
			errors.push({ id, error: "Unknown traffic light id" });
		  }
	  
		  updates.push({ id, status, distance_cm, last_updated });
		  const Current = JSON.stringify({
			connectedusers: this.ctx.getWebSockets().length,
			"1": {
				id: 1,
				status: this.tramLight,
				distance_cm: this.tramDistanceCm,
				last_updated: this.tramLastUpdate,
			},
			"2": {
				id: 2,
				status: this.carLight,
				distance_cm: this.carDistanceCm,
				last_updated: this.carLastUpdate,
			},
		});
		this.ctx.getWebSockets().forEach((ws) => {
			ws.send(Current);
	  	});
		}
	  
		this.env.TrafficLightDemoKV.put("tram", JSON.stringify({
			status: this.tramLight,
			distance_cm: this.tramDistanceCm,
			last_updated: this.tramLastUpdate,
		}));
		this.env.TrafficLightDemoKV.put("car", JSON.stringify({
			status: this.carLight,
			distance_cm: this.carDistanceCm,
			last_updated: this.carLastUpdate,
		}));

		if (errors.length > 0) {
		  return 400;
		}
	  
		return 200;
	  }


	  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
		
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		this.currentlyConnectedWebSockets -= 1;
		ws.close(code, "Durable Object is closing WebSocket");
	}

	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	DurableObjectStub::get for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 */

	/**
	 * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
	 *  Object instance receives a request from a Worker via the same method invocation on the stub
	 *
	 * @param name - The name provided to a Durable Object instance from a Worker
	 * @returns The greeting to be sent back to the Worker
	 */
	
}

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	
	async fetch(request, env, ctx): Promise<Response> {

		const demo = env.TrafficLightDemo;
		let id: DurableObjectId = demo.idFromName("demo");
		let stub = demo.get(id);

		if (request.url.endsWith("/websocket")) {
			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				return new Response('Durable Object expected Upgrade: websocket', { status: 426 });
			}
			return stub.fetch(request);
		}


		if (request.url.endsWith("/api/update") && request.method === "POST") {
			if ((await stub.updateChange(request))== 200) {
				return new Response(null, { status: 200 });
			}
			return new Response(null, { status: 400 });
		}

		if (request.url.endsWith("/api/get") && request.method === "GET") {
			return await stub.getState(request);
		}
		  
		return new Response("Invalid request", { status: 400 });
		//let greeting = await stub.sayHello("world");
	},
} satisfies ExportedHandler<Env>;