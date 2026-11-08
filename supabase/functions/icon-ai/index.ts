import {createEdgeHandler} from './handler.ts';
export {createEdgeHandler};
Deno.serve(createEdgeHandler());
