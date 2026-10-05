// worker 入口的解析：与 host.ts 同目录的编译产物 worker.js。
// SEA / bundle 场景由宿主在启动时用 setCodemodeWorkerUrl 指向释放到磁盘的 worker 文件
// （worker_threads 只能加载磁盘上的真实文件，不能加载 SEA 内嵌资产）。

let override: string | URL | undefined;

export function setCodemodeWorkerUrl(url: string | URL | undefined): void {
  override = url;
}

export function resolveCodemodeWorkerUrl(): string | URL | undefined {
  // undefined 让 CodemodeSandbox 使用相对 host.js 的默认 worker.js。
  return override;
}
