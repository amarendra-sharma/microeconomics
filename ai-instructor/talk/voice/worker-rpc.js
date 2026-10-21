// worker-rpc.js - tiny request/response layer over postMessage, with progress events and clean teardown.
export class RpcClient {
  constructor(worker) {
    this.worker = worker; this._id = 0; this._pending = {}; this._listeners = [];
    var self = this;
    worker.onmessage = function (m) {
      var d = m.data || {};
      if (d.event) { for (var i = 0; i < self._listeners.length; i++) { try { self._listeners[i](d); } catch (e) { /* ignore */ } } return; }
      var p = self._pending[d.id]; if (!p) return;
      delete self._pending[d.id];
      if (d.ok) p.resolve(d.result); else { var e = new Error(d.error || 'worker error'); e.name = d.name || 'WorkerError'; p.reject(e); }
    };
    worker.onerror = function (ev) { self._failAll(new Error('worker crashed: ' + (ev && ev.message ? ev.message : 'unknown'))); };
  }
  onEvent(fn) { this._listeners.push(fn); }
  call(op, payload, transfer) {
    var self = this, id = ++this._id;
    return new Promise(function (resolve, reject) {
      self._pending[id] = { resolve: resolve, reject: reject };
      try { self.worker.postMessage({ id: id, op: op, payload: payload }, transfer || []); }
      catch (e) { delete self._pending[id]; reject(e); }
    });
  }
  _failAll(err) { var k; for (k in this._pending) this._pending[k].reject(err); this._pending = {}; }
  terminate() { this._failAll(new Error('worker terminated')); try { this.worker.terminate(); } catch (e) { /* ignore */ } }
}

// Worker side: register handlers; replies are routed back by id. Handler may call emit() for progress.
export function serveRpc(scope, handlers) {
  scope.onmessage = async function (m) {
    var d = m.data || {}, h = handlers[d.op];
    if (!h) { scope.postMessage({ id: d.id, ok: false, error: 'unknown op ' + d.op }); return; }
    try {
      var out = await h(d.payload, function (ev) { scope.postMessage(Object.assign({ event: true }, ev)); });
      var transfer = out && out.__transfer ? out.__transfer : [];
      if (out && out.__transfer) { out = out.value; }
      scope.postMessage({ id: d.id, ok: true, result: out }, transfer);
    } catch (e) { scope.postMessage({ id: d.id, ok: false, error: String(e && e.message ? e.message : e), name: e && e.name }); }
  };
}
