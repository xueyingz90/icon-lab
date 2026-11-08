import {createEdgeHandler} from '../icon-ai/handler.ts';
Deno.serve(createEdgeHandler({client:'figma'}));
