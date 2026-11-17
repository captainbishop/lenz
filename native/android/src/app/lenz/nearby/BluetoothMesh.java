package app.lenz.nearby;

import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.Context;
import android.os.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Consumer;

/** GATT central/peripheral host for the Lenz encrypted-envelope mesh. */
public final class BluetoothMesh {
    public static final UUID SERVICE = UUID.fromString("c9b94972-2218-4b1c-a32c-46c1e5383212");
    public static final UUID CHARACTERISTIC = UUID.fromString("c9b94973-2218-4b1c-a32c-46c1e5383212");
    private static final UUID CCC = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final int MAX_LINKS = 8;
    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Consumer<JSONObject> events;
    private final BluetoothAdapter adapter;
    private final MeshQueue queue;
    private final MeshCore core = new MeshCore();
    private final Map<String, Link> clients = new LinkedHashMap<>(), peripherals = new LinkedHashMap<>();
    private final Map<String, Long> cooldown = new LinkedHashMap<>();
    private final MeshTokens inbound = new MeshTokens();
    private BluetoothGattServer server;
    private BluetoothGattCharacteristic characteristic;
    private String state = "off", owner = "";
    private boolean active = false, advertised = false, scanning = false;
    private long generation;

    private static final class Link {
        final BluetoothDevice device; final BluetoothGatt gatt; final boolean peripheral;
        final ArrayDeque<MeshQueue.Item> pending = new ArrayDeque<>();
        final Set<String> scheduled = new HashSet<>();
        BluetoothGattCharacteristic characteristic;
        List<byte[]> frames;
        MeshQueue.Item item;
        int frame, mtu = 23;
        boolean ready, waiting;
        long operation;
        Link(BluetoothDevice device, BluetoothGatt gatt, boolean peripheral) { this.device = device; this.gatt = gatt; this.peripheral = peripheral; }
    }
    public BluetoothMesh(Context context, Consumer<JSONObject> events) {
        this.context = context; this.events = events;
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = manager == null ? null : manager.getAdapter();
        queue = new MeshQueue(new File(context.getFilesDir(), "bluetooth/envelopes.bin"));
    }
    private static JSONObject json(Object... fields) {
        JSONObject value = new JSONObject();
        try { for (int i = 0; i < fields.length; i += 2) value.put((String) fields[i], fields[i + 1]); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return value;
    }
    public JSONObject status() {
        Set<String> peers = new HashSet<>();
        for (Link link : clients.values()) if (link.ready) peers.add(link.device.getAddress());
        for (Link link : peripherals.values()) if (link.ready) peers.add(link.device.getAddress());
        return json("state", state, "peers", peers.size());
    }
    private void changed(String next) { state = next; JSONObject status = status(); try { status.put("type", "status"); } catch (JSONException ignored) {} events.accept(status); }
    public void permission() { changed("permission"); }
    public void unavailable() { changed("unavailable"); }
    public void start(String nextOwner) throws IOException {
        if (active && owner.equals(nextOwner)) { changed(state); return; }
        suspend(); queue.open(nextOwner, System.currentTimeMillis()); owner = nextOwner;
        if (adapter == null || !adapter.isEnabled() || adapter.getBluetoothLeAdvertiser() == null || adapter.getBluetoothLeScanner() == null) { changed("unavailable"); return; }
        active = true; generation++; changed("starting");
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        server = manager.openGattServer(context, serverCallback(generation));
        if (server == null) { failed(); return; }
        characteristic = new BluetoothGattCharacteristic(CHARACTERISTIC, BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_INDICATE,
            BluetoothGattCharacteristic.PERMISSION_WRITE);
        characteristic.addDescriptor(new BluetoothGattDescriptor(CCC, BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
        BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(characteristic);
        if (!server.addService(service)) failed();
    }
    private void startRadios() {
        if (!active) return;
        try {
            AdvertiseSettings settings = new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setConnectable(true).setTimeout(0).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM).build();
            AdvertiseData data = new AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false).addServiceUuid(new ParcelUuid(SERVICE)).build();
            adapter.getBluetoothLeAdvertiser().startAdvertising(settings, data, advertiseCallback);
            adapter.getBluetoothLeScanner().startScan(Collections.singletonList(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build()),
                new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
            scanning = true;
        } catch (RuntimeException error) { failed(); }
    }
    private void failed() { suspend(); changed("unavailable"); }
    public void suspend() {
        active = false; generation++; inbound.clear(); core.clear();
        try {
            if (adapter != null) {
                if (scanning && adapter.getBluetoothLeScanner() != null) adapter.getBluetoothLeScanner().stopScan(scanCallback);
                if (adapter.getBluetoothLeAdvertiser() != null) adapter.getBluetoothLeAdvertiser().stopAdvertising(advertiseCallback);
            }
        } catch (RuntimeException ignored) {}
        scanning = false; advertised = false;
        for (Link link : new ArrayList<>(clients.values())) { try { link.gatt.disconnect(); link.gatt.close(); } catch (RuntimeException ignored) {} }
        clients.clear(); peripherals.clear(); cooldown.clear();
        if (server != null) { try { server.close(); } catch (RuntimeException ignored) {} server = null; }
        changed("off");
    }
    public void stop() throws IOException { suspend(); owner = ""; queue.clear(); }
    private static long envelopeExpiry(byte[] payload) throws JSONException {
        JSONObject envelope = new JSONObject(new String(payload, StandardCharsets.UTF_8));
        if (!"lenz/carrier/v1".equals(envelope.optString("type"))) throw new IllegalArgumentException("Only encrypted Lenz carrier envelopes are supported.");
        long now = System.currentTimeMillis(), expiry = envelope.getLong("expiresAt"), created = envelope.getLong("createdAt");
        if (created < 0 || created > now + 60000 || expiry <= now || expiry <= created || expiry - created > MeshQueue.MAX_LIFETIME || expiry - now > MeshQueue.MAX_LIFETIME) throw new IllegalArgumentException("Lenz envelope retention is invalid.");
        return expiry;
    }
    public JSONObject send(String scope, byte[] bytes) throws Exception {
        if (!active || !owner.equals(scope)) throw new IllegalStateException("Open the current Lenz account and enable Bluetooth first.");
        JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!owner.equals(envelope.getJSONObject("sender").getString("id")) || !owner.equals(envelope.getJSONObject("packet").getString("from"))) throw new IllegalArgumentException("The Bluetooth envelope belongs to another Lenz account.");
        MeshQueue.Item item = queue.add(bytes, MeshCore.MAX_HOPS, envelopeExpiry(bytes), "", System.currentTimeMillis());
        dispatch(item);
        return json("queued", true, "id", item.id);
    }
    public JSONObject forward(String token) throws Exception {
        if (!active) throw new IllegalStateException("Bluetooth is stopped.");
        MeshTokens.Pending value = inbound.take(token, owner, SystemClock.elapsedRealtime());
        if (value.hops <= 1) return json("forwarded", false);
        MeshQueue.Item item = queue.add(value.bytes, value.hops - 1, envelopeExpiry(value.bytes), value.source, System.currentTimeMillis());
        dispatch(item); return json("forwarded", true);
    }
    public JSONObject discard(String token) {
        if (!active) throw new IllegalStateException("Bluetooth is stopped.");
        inbound.take(token, owner, SystemClock.elapsedRealtime()); return json("discarded", true);
    }
    public JSONObject forget(byte[] payload) throws IOException {
        String id = queue.forget(payload);
        for (Link link : new ArrayList<>(clients.values())) cancel(link, id);
        for (Link link : new ArrayList<>(peripherals.values())) cancel(link, id);
        return json("forgotten", !id.isEmpty());
    }
    private void cancel(Link link, String id) {
        if (id.isEmpty()) return;
        link.pending.removeIf(item -> item.id.equals(id)); link.scheduled.remove(id);
        if (link.item != null && link.item.id.equals(id)) drop(link);
    }
    private void received(String source, byte[] frame) {
        if (!active) return;
        try {
            MeshCore.Envelope envelope = core.receive(source, frame, SystemClock.elapsedRealtime());
            if (envelope == null) return;
            envelopeExpiry(envelope.bytes);
            String token = inbound.offer(envelope, source, owner, SystemClock.elapsedRealtime());
            events.accept(json("type", "envelope", "payload", Base64.encodeToString(envelope.bytes, Base64.NO_WRAP), "token", token, "hops", envelope.hops));
        } catch (Exception rejected) { /* Hostile or incomplete radio traffic grants no forwarding authority. */ }
    }
    private void dispatch(MeshQueue.Item item) {
        pruneScheduled();
        for (Link link : clients.values()) schedule(link, item);
        for (Link link : peripherals.values()) schedule(link, item);
    }
    private void flush(Link link) {
        try { pruneScheduled(); for (MeshQueue.Item item : queue.pending(System.currentTimeMillis())) schedule(link, item); }
        catch (IOException unavailable) { failed(); }
    }
    private void pruneScheduled() {
        try {
            Set<String> retained = new HashSet<>(); for (MeshQueue.Item item : queue.pending(System.currentTimeMillis())) retained.add(item.id);
            for (Link link : clients.values()) { link.scheduled.retainAll(retained); link.pending.removeIf(item -> !retained.contains(item.id)); }
            for (Link link : peripherals.values()) { link.scheduled.retainAll(retained); link.pending.removeIf(item -> !retained.contains(item.id)); }
        } catch (IOException unavailable) { failed(); }
    }
    private void schedule(Link link, MeshQueue.Item item) {
        String peer = link.device.getAddress();
        if (!link.ready || item.ingress.equals(peer) || link.scheduled.contains(item.id) || item.attempts.getOrDefault(peer, 0) >= 3) return;
        link.scheduled.add(item.id); link.pending.add(item); pump(link);
    }
    private boolean current(Link link) { return active && (link.peripheral ? peripherals.get(link.device.getAddress()) : clients.get(link.device.getAddress())) == link; }
    private void pump(Link link) {
        if (!current(link) || !link.ready || link.waiting) return;
        try {
            if (link.item != null && link.item.expires <= System.currentTimeMillis()) { link.item = null; link.frames = null; }
            if (link.item == null) {
                while (!link.pending.isEmpty() && link.pending.peek().expires <= System.currentTimeMillis()) link.pending.remove();
                if (link.pending.isEmpty()) return;
                link.item = link.pending.remove(); link.frame = 0;
                String peer = link.device.getAddress();
                if (link.item.attempts.getOrDefault(peer, 0) >= 3) { link.item = null; pump(link); return; }
                if (link.item.attempts.size() >= MAX_LINKS && !link.item.attempts.containsKey(peer)) { link.item = null; pump(link); return; }
                link.item.attempts.put(peer, link.item.attempts.getOrDefault(peer, 0) + 1);
                link.frames = MeshCore.fragment(link.item.bytes, link.item.hops, Math.min(512, link.mtu - 3));
            }
            byte[] frame = link.frames.get(link.frame); link.waiting = true; long operation = ++link.operation;
            boolean accepted;
            if (link.peripheral) {
                if (Build.VERSION.SDK_INT >= 33) accepted = server.notifyCharacteristicChanged(link.device, characteristic, true, frame) == BluetoothStatusCodes.SUCCESS;
                else { characteristic.setValue(frame); accepted = server.notifyCharacteristicChanged(link.device, characteristic, true); }
            } else {
                if (Build.VERSION.SDK_INT >= 33) accepted = link.gatt.writeCharacteristic(link.characteristic, frame, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS;
                else { link.characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT); link.characteristic.setValue(frame); accepted = link.gatt.writeCharacteristic(link.characteristic); }
            }
            if (!accepted) { drop(link); return; }
            handler.postDelayed(() -> { if (current(link) && link.waiting && link.operation == operation) drop(link); }, 3000);
        } catch (RuntimeException error) { drop(link); }
    }
    private void sent(Link link, int status) {
        if (!current(link) || !link.waiting) return;
        if (status != BluetoothGatt.GATT_SUCCESS) { drop(link); return; }
        link.waiting = false; link.operation++;
        if (++link.frame >= link.frames.size()) {
            MeshQueue.Item completed = link.item;
            link.item = null; link.frames = null;
            retry(link, completed);
        }
        handler.post(() -> pump(link));
    }
    private void retry(Link link, MeshQueue.Item item) {
        String peer = link.device.getAddress();
        if (item.attempts.getOrDefault(peer, 0) >= 3) return;
        long epoch = generation;
        // GATT completion only confirms frames. Retained bytes still need a Lenz acknowledgement.
        handler.postDelayed(() -> {
            if (generation != epoch || !current(link) || !link.ready) return;
            try {
                long now = System.currentTimeMillis();
                if (item.expires <= now || !queue.pending(now).contains(item)) return;
                if (link.item != null && link.item.id.equals(item.id) || link.pending.stream().anyMatch(pending -> pending.id.equals(item.id))) return;
                link.scheduled.remove(item.id);
                schedule(link, item);
            } catch (IOException unavailable) { failed(); }
        }, 10000);
    }
    private void drop(Link link) {
        String peer = link.device.getAddress(); backoff(peer, 3000);
        if (link.peripheral) { peripherals.remove(peer); if (server != null) { try { server.cancelConnection(link.device); } catch (RuntimeException ignored) {} } }
        else { clients.remove(peer); try { link.gatt.disconnect(); link.gatt.close(); } catch (RuntimeException ignored) {} }
        changed(state);
    }
    private void backoff(String peer, long delay) {
        cooldown.put(peer, SystemClock.elapsedRealtime() + delay);
        while (cooldown.size() > 128) cooldown.remove(cooldown.keySet().iterator().next());
    }
    private void ready(Link link) {
        if (!current(link) || link.mtu < 64) { drop(link); return; }
        link.ready = true; changed(advertised ? "ready" : "starting"); flush(link);
    }
    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override public void onStartSuccess(AdvertiseSettings settings) { handler.post(() -> { if (active) { advertised = true; changed("ready"); } }); }
        @Override public void onStartFailure(int error) { handler.post(() -> { if (active) failed(); }); }
    };
    private final ScanCallback scanCallback = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult result) {
            handler.post(() -> {
                if (!active || clients.size() + peripherals.size() >= MAX_LINKS || result.getRssi() < -85) return;
                BluetoothDevice device = result.getDevice(); String peer = device.getAddress();
                long now = SystemClock.elapsedRealtime(); cooldown.values().removeIf(until -> until <= now);
                while (cooldown.size() > 128) cooldown.remove(cooldown.keySet().iterator().next());
                if (clients.containsKey(peer) || peripherals.containsKey(peer) || cooldown.getOrDefault(peer, 0L) > SystemClock.elapsedRealtime()) return;
                try {
                    BluetoothGatt gatt = device.connectGatt(context, false, clientCallback, BluetoothDevice.TRANSPORT_LE);
                    if (gatt != null) {
                        Link link = new Link(device, gatt, false); clients.put(peer, link); long epoch = generation;
                        handler.postDelayed(() -> { if (generation == epoch && current(link) && !link.ready) drop(link); }, 15000);
                    }
                } catch (RuntimeException ignored) { backoff(peer, 30000); }
            });
        }
        @Override public void onScanFailed(int error) { handler.post(() -> { if (active) failed(); }); }
    };
    private final BluetoothGattCallback clientCallback = new BluetoothGattCallback() {
        private Link link(BluetoothGatt gatt) { Link link = clients.get(gatt.getDevice().getAddress()); return link != null && link.gatt == gatt ? link : null; }
        @Override public void onConnectionStateChange(BluetoothGatt gatt, int status, int next) {
            handler.post(() -> {
                Link link = link(gatt); if (link == null || !active) { gatt.close(); return; }
                if (status == BluetoothGatt.GATT_SUCCESS && next == BluetoothProfile.STATE_CONNECTED) {
                    if (!gatt.requestMtu(517)) drop(link);
                } else if (next == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) drop(link);
            });
        }
        @Override public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            handler.post(() -> { Link link = link(gatt); if (link == null) return; link.mtu = mtu; if (status != BluetoothGatt.GATT_SUCCESS || mtu < 64 || !gatt.discoverServices()) drop(link); });
        }
        @Override public void onServiceChanged(BluetoothGatt gatt) {
            handler.post(() -> { Link link = link(gatt); if (link != null) drop(link); });
        }
        @Override public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            handler.post(() -> {
                Link link = link(gatt); if (link == null) return;
                BluetoothGattService service = gatt.getService(SERVICE); link.characteristic = service == null ? null : service.getCharacteristic(CHARACTERISTIC);
                BluetoothGattDescriptor descriptor = link.characteristic == null ? null : link.characteristic.getDescriptor(CCC);
                if (status != BluetoothGatt.GATT_SUCCESS || descriptor == null || !gatt.setCharacteristicNotification(link.characteristic, true)) { drop(link); return; }
                boolean accepted;
                if (Build.VERSION.SDK_INT >= 33) accepted = gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_INDICATION_VALUE) == BluetoothStatusCodes.SUCCESS;
                else { descriptor.setValue(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE); accepted = gatt.writeDescriptor(descriptor); }
                if (!accepted) drop(link);
            });
        }
        @Override public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            handler.post(() -> { Link link = link(gatt); if (link != null) { if (status == BluetoothGatt.GATT_SUCCESS && descriptor.getUuid().equals(CCC)) ready(link); else drop(link); } });
        }
        @Override public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            handler.post(() -> { Link link = link(gatt); if (link != null && characteristic.getUuid().equals(CHARACTERISTIC)) sent(link, status); });
        }
        @Override public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            byte[] copy = value.clone(); handler.post(() -> { Link link = link(gatt); if (link != null && link.ready && characteristic.getUuid().equals(CHARACTERISTIC)) received(link.device.getAddress(), copy); });
        }
        @Override public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            byte[] value = characteristic.getValue(); if (value != null) onCharacteristicChanged(gatt, characteristic, value);
        }
    };
    private BluetoothGattServerCallback serverCallback(long epoch) { return new BluetoothGattServerCallback() {
        private void post(Runnable task) { handler.post(() -> { if (active && generation == epoch) task.run(); }); }
        @Override public void onServiceAdded(int status, BluetoothGattService service) { post(() -> { if (status == BluetoothGatt.GATT_SUCCESS) startRadios(); else failed(); }); }
        @Override public void onConnectionStateChange(BluetoothDevice device, int status, int next) {
            post(() -> {
                if (!active || server == null) return; String peer = device.getAddress();
                if (next == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    if (peripherals.size() + clients.size() >= MAX_LINKS) { server.cancelConnection(device); return; }
                    Link link = new Link(device, null, true); peripherals.put(peer, link); long epoch = generation;
                    handler.postDelayed(() -> { if (generation == epoch && current(link) && !link.ready) drop(link); }, 15000);
                } else if (next == BluetoothProfile.STATE_DISCONNECTED) { peripherals.remove(peer); changed(state); }
            });
        }
        @Override public void onMtuChanged(BluetoothDevice device, int mtu) { post(() -> { Link link = peripherals.get(device.getAddress()); if (link != null) link.mtu = mtu; }); }
        @Override public void onDescriptorReadRequest(BluetoothDevice device, int request, int offset, BluetoothGattDescriptor descriptor) {
            post(() -> { if (server != null) server.sendResponse(device, request, offset == 0 && descriptor.getUuid().equals(CCC) ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_FAILURE, 0, BluetoothGattDescriptor.ENABLE_INDICATION_VALUE); });
        }
        @Override public void onDescriptorWriteRequest(BluetoothDevice device, int request, BluetoothGattDescriptor descriptor, boolean prepared, boolean response, int offset, byte[] value) {
            byte[] copy = value.clone(); post(() -> {
                if (!active || server == null) return; Link link = peripherals.get(device.getAddress());
                boolean accepted = link != null && !prepared && offset == 0 && descriptor.getUuid().equals(CCC) && Arrays.equals(copy, BluetoothGattDescriptor.ENABLE_INDICATION_VALUE);
                if (response) server.sendResponse(device, request, accepted ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_FAILURE, 0, null);
                if (accepted) ready(link);
            });
        }
        @Override public void onCharacteristicWriteRequest(BluetoothDevice device, int request, BluetoothGattCharacteristic characteristic, boolean prepared, boolean response, int offset, byte[] value) {
            byte[] copy = value.clone(); post(() -> {
                if (!active || server == null) return; Link link = peripherals.get(device.getAddress());
                boolean accepted = link != null && link.ready && !prepared && offset == 0 && characteristic.getUuid().equals(CHARACTERISTIC) && copy.length > 28 && copy.length <= Math.min(512, link.mtu - 3);
                if (response) server.sendResponse(device, request, accepted ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_FAILURE, 0, null);
                if (accepted) received(device.getAddress(), copy);
            });
        }
        @Override public void onExecuteWrite(BluetoothDevice device, int request, boolean execute) { post(() -> { if (server != null) server.sendResponse(device, request, BluetoothGatt.GATT_FAILURE, 0, null); }); }
        @Override public void onNotificationSent(BluetoothDevice device, int status) { post(() -> { Link link = peripherals.get(device.getAddress()); if (link != null) sent(link, status); }); }
    }; }
}
