package io.github.dreamtheater484.memora

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.security.KeyStore
import java.security.SecureRandom
import java.util.zip.ZipInputStream
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Memora's engine on the phone: the same server as in Docker and the desktop app, run by Node.js
 * as a program of its own (libnode.so, from the app's library folder: the one place Android lets
 * an app run a program from). It listens on 127.0.0.1 only; the window signs in with a secret
 * made anew at each start, as in the desktop app.
 */
class Engine(private val context: Context) {
    companion object {
        const val TAG = "Memora"
        private const val MARK = "\u001eMEMORA "
        private const val BRIDGE = "memora-bridge"
    }

    val token: String = ByteArray(32).also { SecureRandom().nextBytes(it) }
        .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP) }
    var port = 0
        private set
    val origin get() = "http://127.0.0.1:$port"
    val startedAt = SystemClock.elapsedRealtime()

    private var process: Process? = null
    private var stdin: OutputStreamWriter? = null
    private val listeners = mutableListOf<(Int) -> Unit>()
    @Volatile private var ready = false

    fun signInUrl(next: String = "/") =
        "$origin/api/v1/auth/desktop?token=$token&next=${java.net.URLEncoder.encode(next, "UTF-8")}"

    /** Calls back on Node's reader thread once the server answers. */
    fun whenReady(listener: (Int) -> Unit) {
        synchronized(listeners) {
            if (ready) listener(port) else listeners.add(listener)
        }
    }

    fun start() {
        val engineDir = unpack()
        port = choosePort()
        val node = File(context.applicationInfo.nativeLibraryDir, "libnode.so")
        val data = File(context.filesDir, "Data").apply { mkdirs() }
        val builder = ProcessBuilder(
            node.path,
            "--max-old-space-size=192",
            File(engineDir, "android.cjs").path,
        ).directory(engineDir)
        builder.environment().apply {
            put("NODE_ENV", "production")
            put("HOST", "127.0.0.1")
            put("PORT", port.toString())
            put("MEMORA_DATA_DIR", data.path)
            put("MEMORA_BASE_URL", origin)
            put("MEMORA_TRUST_PROXY", "false")
            put("MEMORA_DESKTOP_TOKEN", token)
            put("MEMORA_DESKTOP_NAME", Build.MODEL ?: "Android")
            put("MEMORA_DESKTOP_SHELL", "android")
            put("MEMORA_NATIVE_LIB_DIR", context.applicationInfo.nativeLibraryDir)
            // Android has no /tmp: Node's os.tmpdir() and the server's temporary files go here.
            put("TMPDIR", context.cacheDir.path)
            put("HOME", context.filesDir.path)
        }
        builder.redirectErrorStream(true)
        val started = builder.start()
        process = started
        stdin = OutputStreamWriter(started.outputStream, Charsets.UTF_8)
        Log.i(TAG, "engine: started Node.js on port $port")
        val log = File(context.filesDir, "logs").apply { mkdirs() }.let { File(it, "memora.log") }
        Thread({
            FileOutputStream(log, true).bufferedWriter().use { out ->
                started.inputStream.bufferedReader().forEachLine { line ->
                    if (line.startsWith(MARK)) {
                        onMessage(line.substring(MARK.length))
                    } else {
                        out.write(line); out.newLine(); out.flush()
                        Log.d(TAG, line)
                    }
                }
            }
            Log.w(TAG, "engine: Node.js stopped (exit ${runCatching { started.waitFor() }.getOrNull()})")
        }, "memora-engine").start()
    }

    fun stop() {
        send("shutdown")
        process?.let { p ->
            Thread {
                if (!p.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)) p.destroy()
            }.start()
        }
    }

    private fun send(message: Any) {
        val line = if (message is String) JSONObject.quote(message) else message.toString()
        synchronized(this) {
            runCatching { stdin?.apply { write(line); write("\n"); flush() } }
        }
    }

    private fun onMessage(json: String) {
        val message = runCatching { JSONObject(json) }.getOrNull() ?: return
        when (message.optString("type")) {
            "ready" -> {
                val elapsed = SystemClock.elapsedRealtime() - startedAt
                Log.i(TAG, "trial: server ready ${elapsed}ms after the engine started")
                synchronized(listeners) {
                    ready = true
                    listeners.forEach { it(port) }
                    listeners.clear()
                }
            }
            BRIDGE -> answer(message)
        }
    }

    /** What only the app can do for the server (apps/desktop/src/bridge.ts on the desktop). */
    private fun answer(request: JSONObject) {
        val id = request.getInt("id")
        val reply = JSONObject().put("type", BRIDGE).put("id", id)
        try {
            val value: Any? = when (request.getString("op")) {
                "secrets.available" -> true
                "secrets.load" -> Secrets.load(context)
                "secrets.save" -> {
                    Secrets.save(context, if (request.isNull("value")) null else request.getString("value"))
                    true
                }
                // No folder sync on the phone: Android's apps don't keep a cloud folder in sync.
                "pick-folder" -> null
                else -> throw IllegalArgumentException("Unknown request: ${request.getString("op")}")
            }
            reply.put("ok", true).put("value", value ?: JSONObject.NULL)
        } catch (error: Exception) {
            reply.put("ok", false).put("error", error.message ?: "Failed.")
        }
        send(reply)
    }

    /** The engine's files (server, migrations, web app), unpacked once per version of the app. */
    private fun unpack(): File {
        val version = context.packageManager.getPackageInfo(context.packageName, 0).let {
            @Suppress("DEPRECATION") it.versionCode.toString() + "-" + it.lastUpdateTime
        }
        val dir = File(context.filesDir, "engine")
        val stamp = File(dir, ".version")
        if (stamp.exists() && stamp.readText() == version) return dir
        val begin = SystemClock.elapsedRealtime()
        dir.deleteRecursively()
        dir.mkdirs()
        ZipInputStream(context.assets.open("engine.zip").buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val target = File(dir, entry.name)
                require(target.canonicalPath.startsWith(dir.canonicalPath + File.separator))
                if (entry.isDirectory) target.mkdirs() else {
                    target.parentFile?.mkdirs()
                    target.outputStream().use { zip.copyTo(it) }
                }
            }
        }
        stamp.writeText(version)
        Log.i(TAG, "trial: unpacked the engine in ${SystemClock.elapsedRealtime() - begin}ms")
        return dir
    }

    /** The same port every start: the web app keeps its offline storage per address. */
    private fun choosePort(): Int {
        val prefs = context.getSharedPreferences("engine", Context.MODE_PRIVATE)
        val saved = prefs.getInt("port", 0)
        if (saved != 0 && isFree(saved)) return saved
        val port = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
        prefs.edit().putInt("port", port).apply()
        return port
    }

    private fun isFree(port: Int) =
        runCatching { ServerSocket(port, 1, InetAddress.getByName("127.0.0.1")).close() }.isSuccess
}

/** Sync's secrets, sealed with a key that Android's keystore keeps and never lets out. */
object Secrets {
    private const val ALIAS = "memora-sync"
    private fun file(context: Context) = File(context.filesDir, "sync.secrets")

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun load(context: Context): String? {
        val data = runCatching { file(context).readBytes() }.getOrNull() ?: return null
        return runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data, 0, 12))
            String(cipher.doFinal(data, 12, data.size - 12), Charsets.UTF_8)
        }.getOrNull()
    }

    fun save(context: Context, value: String?) {
        if (value == null) {
            file(context).delete()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val tmp = File(context.filesDir, "sync.secrets.tmp")
        tmp.writeBytes(sealed)
        tmp.renameTo(file(context))
    }
}
