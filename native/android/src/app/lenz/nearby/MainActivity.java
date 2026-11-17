package app.lenz.nearby;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.util.Base64;
import android.webkit.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Hosts only packaged Lenz code; the message port is never installed on a remote page. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int BLUETOOTH_PERMISSION = 41, BLUETOOTH_ENABLE = 42, FILE_PICKER = 43, CAMERA_PERMISSION = 44;
    private WebView web;
    private BluetoothMesh mesh;
    private WebMessagePort port;
    private String owner = "";
    private boolean wanted;
    private ValueCallback<Uri[]> filePicker;
    private PermissionRequest cameraRequest;
    private final BroadcastReceiver bluetoothState = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!BluetoothAdapter.ACTION_STATE_CHANGED.equals(intent.getAction()) || mesh == null) return;
            int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
            if (state == BluetoothAdapter.STATE_OFF || state == BluetoothAdapter.STATE_TURNING_OFF) { mesh.suspend(); mesh.unavailable(); }
            else if (state == BluetoothAdapter.STATE_ON && wanted) { try { startBluetooth(); } catch (IOException unavailable) { mesh.unavailable(); } }
        }
    };
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        mesh = new BluetoothMesh(this, this::event);
        // Bluetooth's protected system broadcast may come from its separate privileged UID.
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(bluetoothState, new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), Context.RECEIVER_EXPORTED);
        else registerReceiver(bluetoothState, new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED));
        web = new WebView(this); setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setSafeBrowsingEnabled(true);
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) { return intercept(request); }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !local(request.getUrl()); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return intercept(request);
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                wanted = false; closePort(); mesh.suspend();
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!local(Uri.parse(url))) return;
                closePort(); WebMessagePort[] channel = web.createWebMessageChannel(); port = channel[0];
                WebMessagePort attached = port;
                port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                    @Override public void onMessage(WebMessagePort source, WebMessage message) { if (port == attached) command(message.getData()); }
                });
                web.postWebMessage(new WebMessage("{\"type\":\"lenz-bluetooth-ready\",\"version\":1}", new WebMessagePort[]{channel[1]}), Uri.parse(ORIGIN));
                event(statusEvent());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    String[] resources = request.getResources();
                    if (!local(request.getOrigin()) || web == null || web.getUrl() == null || !local(Uri.parse(web.getUrl())) || resources.length != 1 || !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resources[0])) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); return; }
                    if (cameraRequest != null) cameraRequest.deny(); cameraRequest = request;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { runOnUiThread(() -> { if (cameraRequest == request) cameraRequest = null; }); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (filePicker != null) filePicker.onReceiveValue(null);
                filePicker = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, FILE_PICKER); return true; }
                catch (ActivityNotFoundException unavailable) { filePicker = null; callback.onReceiveValue(null); return false; }
            }
        });
        if (saved == null) web.loadUrl(ORIGIN + "/chat.html"); else if (web.restoreState(saved) == null) web.loadUrl(ORIGIN + "/chat.html");
    }
    private WebResourceResponse intercept(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!local(uri)) return request.isForMainFrame() ? response(403, "text/plain", new ByteArrayInputStream(new byte[0])) : null;
        String path = uri.getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        if (!"GET".equals(request.getMethod()) || path.contains("..") || path.indexOf('\0') >= 0 || path.indexOf('\\') >= 0) return response(404, "text/plain", new ByteArrayInputStream(new byte[0]));
        try { return response(200, mime(path), getAssets().open("web" + path)); }
        catch (IOException missing) { return response(404, "text/plain", new ByteArrayInputStream(new byte[0])); }
    }
    private static boolean local(Uri uri) { return uri != null && "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && uri.getPort() == -1 && uri.getUserInfo() == null; }
    private static String mime(String path) {
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".svg")) return "image/svg+xml";
        String value = MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(path));
        return value == null ? "application/octet-stream" : value;
    }
    private static WebResourceResponse response(int status, String mime, InputStream content) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src https: wss:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
        headers.put("X-Content-Type-Options", "nosniff"); headers.put("Referrer-Policy", "no-referrer"); headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, "UTF-8", status, status == 200 ? "OK" : "Unavailable", headers, content);
    }
    private static JSONObject json(Object... fields) {
        JSONObject value = new JSONObject();
        try { for (int i = 0; i < fields.length; i += 2) value.put((String) fields[i], fields[i + 1]); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return value;
    }
    private JSONObject statusEvent() {
        JSONObject status = mesh.status(); try { status.put("type", "status"); } catch (JSONException ignored) {} return status;
    }
    private void event(JSONObject value) { if (port != null) { try { port.postMessage(new WebMessage(value.toString())); } catch (RuntimeException closed) { closePort(); } } }
    private void closePort() { if (port != null) { try { port.close(); } catch (RuntimeException ignored) {} port = null; } }
    private void command(String data) {
        String id = "";
        try {
            if (data == null || data.length() > 280000) throw new IllegalArgumentException("Bluetooth command is too large.");
            JSONObject command = new JSONObject(data); id = command.getString("id");
            if (id.isEmpty() || id.length() > 80) throw new IllegalArgumentException("Invalid Bluetooth command ID.");
            String op = command.getString("op"); JSONObject result;
            switch (op) {
                case "status": result = mesh.status(); break;
                case "start":
                    String nextOwner = command.getString("owner");
                    if (!nextOwner.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid Lenz account.");
                    if (!owner.isEmpty() && !owner.equals(nextOwner)) mesh.stop(); owner = nextOwner; wanted = true; startBluetooth(); result = mesh.status(); break;
                case "stop": wanted = false; owner = ""; mesh.stop(); result = mesh.status(); break;
                case "send":
                case "forget":
                    String payload = command.getString("payload");
                    if (payload.length() > 273068 || !payload.matches("[A-Za-z0-9+/]*={0,2}")) throw new IllegalArgumentException("Invalid Bluetooth payload.");
                    byte[] bytes = Base64.decode(payload, Base64.NO_WRAP);
                    if (bytes.length > MeshCore.MAX_BYTES) throw new IllegalArgumentException("Bluetooth payload is too large.");
                    result = "send".equals(op) ? mesh.send(owner, bytes) : mesh.forget(bytes); break;
                case "forward":
                case "discard":
                    String token = command.getString("token"); if (token.length() > 64) throw new IllegalArgumentException("Invalid forwarding permission.");
                    result = "forward".equals(op) ? mesh.forward(token) : mesh.discard(token); break;
                default: throw new IllegalArgumentException("Unsupported Bluetooth command.");
            }
            event(json("id", id, "ok", true, "result", result));
        } catch (Exception error) { event(json("id", id, "ok", false, "error", json("code", "bluetooth-unavailable", "message", error.getMessage() == null ? "Bluetooth operation failed." : error.getMessage()))); }
    }
    private String[] bluetoothPermissions() {
        return Build.VERSION.SDK_INT >= 31 ? new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE} : new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
    }
    private void startBluetooth() throws IOException {
        if (!wanted || owner.isEmpty()) return;
        List<String> missing = new ArrayList<>();
        for (String permission : bluetoothPermissions()) if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
        if (!missing.isEmpty()) { mesh.permission(); requestPermissions(missing.toArray(new String[0]), BLUETOOTH_PERMISSION); return; }
        BluetoothAdapter adapter = ((android.bluetooth.BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE)).getAdapter();
        if (adapter != null && !adapter.isEnabled()) { mesh.unavailable(); startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), BLUETOOTH_ENABLE); return; }
        mesh.start(owner);
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == CAMERA_PERMISSION) {
            PermissionRequest current = cameraRequest; cameraRequest = null;
            if (current != null) {
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED && web != null && web.getUrl() != null && local(Uri.parse(web.getUrl())) && local(current.getOrigin())) current.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                else current.deny();
            }
            return;
        }
        if (request != BLUETOOTH_PERMISSION || !wanted) return;
        for (String permission : bluetoothPermissions()) if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) { wanted = false; mesh.permission(); return; }
        try { startBluetooth(); } catch (IOException unavailable) { mesh.unavailable(); }
    }
    @Override public void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_PICKER && filePicker != null) { filePicker.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null); filePicker = null; }
        if (request == BLUETOOTH_ENABLE && wanted) { if (result == RESULT_OK) { try { startBluetooth(); } catch (IOException unavailable) { mesh.unavailable(); } } else { wanted = false; mesh.unavailable(); } }
    }
    @Override public void onResume() { super.onResume(); if (web != null) web.onResume(); if (wanted) { try { startBluetooth(); } catch (IOException unavailable) { mesh.unavailable(); } } }
    @Override public void onPause() { if (mesh != null) mesh.suspend(); if (web != null) web.onPause(); super.onPause(); }
    @Override public void onSaveInstanceState(Bundle saved) { web.saveState(saved); super.onSaveInstanceState(saved); }
    @Override public void onDestroy() { unregisterReceiver(bluetoothState); if (cameraRequest != null) { cameraRequest.deny(); cameraRequest = null; } closePort(); if (mesh != null) mesh.suspend(); if (web != null) { web.destroy(); web = null; } super.onDestroy(); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
