import {handler} from "../media-worker.mjs";
const app = handler({});
export default {fetch: request => app.fetch(request, process.env)};
