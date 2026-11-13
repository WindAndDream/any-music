import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Set;
import java.util.jar.JarFile;
import java.util.zip.ZipFile;

/** Reads built archives without extraction. AAB signatures must cover every payload,
 * and APK/AAB native libraries must all match the requested ABI and 16 KiB layout. */
class VerifyAndroidRelease {
    static void require(boolean value, String message) {
        if (!value) throw new IllegalStateException(message);
    }
    static String digest(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    static void elf(byte[] bytes, String abi) {
        require(bytes.length >= 64, "Truncated ELF");
        ByteBuffer b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        require(b.getInt(0) == 0x464c457f && b.get(4) == 2 && b.get(5) == 1, "Expected little endian ELF64");
        require(Short.toUnsignedInt(b.getShort(18)) == (abi.equals("arm64-v8a") ? 183 : 62), "ELF machine differs from ABI");
        long offset = b.getLong(32);
        int size = Short.toUnsignedInt(b.getShort(54));
        int count = Short.toUnsignedInt(b.getShort(56));
        require(offset >= 64 && size >= 56 && count > 0 && offset + (long)size * count <= bytes.length, "Invalid ELF program headers");
        int loads = 0;
        for (int n = 0; n < count; n++) {
            int p = Math.toIntExact(offset + (long)n * size);
            if (b.getInt(p) != 1) continue;
            loads++;
            long alignment = b.getLong(p + 48);
            require(alignment >= 16384 && (alignment & (alignment - 1)) == 0, "ELF LOAD lacks 16 KiB alignment");
            require(b.getLong(p + 8) % alignment == b.getLong(p + 16) % alignment, "ELF LOAD offset is misaligned");
        }
        require(loads > 0, "Missing ELF LOAD segments");
    }
    static Set<String> nativeLibraries(Path file, String prefix, String abi) throws Exception {
        Set<String> names = new HashSet<>();
        Set<String> entries = new HashSet<>();
        try (ZipFile zip = new ZipFile(file.toFile())) {
            var all = zip.entries();
            while (all.hasMoreElements()) {
                var entry = all.nextElement();
                require(entries.add(entry.getName()), "Duplicate archive entry");
                require(!entry.getName().endsWith("assets/fixture.amplugin"), "Test package fixture entered release");
                if (!entry.getName().startsWith(prefix) || !entry.getName().endsWith(".so")) continue;
                String name = entry.getName().substring(prefix.length());
                require(name.startsWith(abi + "/") && name.split("/").length == 2, "Unexpected ABI in archive");
                require(entry.getSize() > 0 && entry.getSize() <= 256L * 1024 * 1024, "Native library exceeds verification budget");
                try (InputStream in = zip.getInputStream(entry)) {
                    elf(in.readNBytes(Math.toIntExact(entry.getSize())), abi);
                }
                names.add(name);
            }
        }
        require(names.contains(abi + "/libany_music_tauri_lib.so"), "Missing application JNI library");
        return names;
    }
    static void bundleSignature(Path file, String expected) throws Exception {
        try (JarFile jar = new JarFile(file.toFile(), true)) {
            var entries = jar.entries();
            byte[] buffer = new byte[65536];
            int payloads = 0;
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (entry.isDirectory()) continue;
                try (InputStream in = jar.getInputStream(entry)) { while (in.read(buffer) != -1) { } }
                // Only JAR signing metadata is exempt; arbitrary META-INF payload is signed too.
                if (entry.getName().matches("(?i)META-INF/(MANIFEST\\.MF|[^/]+\\.(SF|RSA|DSA|EC))")) continue;
                var signers = entry.getCodeSigners();
                require(signers != null && signers.length == 1, "Unsigned or multiply signed AAB payload");
                var cert = signers[0].getSignerCertPath().getCertificates().get(0);
                require(digest(cert.getEncoded()).equals(expected), "APK and AAB signer differ");
                payloads++;
            }
            require(payloads > 0, "Empty AAB");
        }
    }
    public static void main(String[] args) throws Exception {
        require(args.length == 4, "Expected APK AAB ABI signer-SHA256");
        Path apk = Path.of(args[0]), aab = Path.of(args[1]);
        Set<String> apkNames = nativeLibraries(apk, "lib/", args[2]);
        Set<String> aabNames = nativeLibraries(aab, "base/lib/", args[2]);
        require(apkNames.equals(aabNames), "APK and AAB native library sets differ");
        bundleSignature(aab, args[3]);
        System.out.println("{\"bundlePayloadSignatures\":true,\"native16KiBAlignment\":true,\"nativeLibraryCount\":" + apkNames.size() + "}");
    }
}
