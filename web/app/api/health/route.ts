import packageJson from '../../../package.json';
export async function GET() { return Response.json({ ok: true, service: `cobalt-v${packageJson.version}`, version: packageJson.version }); }
