package io.github.magiertx.cfa.prom;

import com.sun.net.httpserver.Filter;
import com.sun.net.httpserver.HttpContext;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpsServer;
import com.sun.net.httpserver.spi.HttpServerProvider;

import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.Executor;

/**
 * Starts ProM4Py for the desktop app (docs/DESKTOP.md, "ProM in the desktop app").
 *
 * <p>ProM4Py's server listens on every network interface and runs whatever {@code /executor}
 * is sent, without asking who sends it. In the Docker stack only the compose network reaches
 * it; on a desktop the local network and every web page open in a browser could. So this
 * class, the main class instead of {@code ProM4PY}, changes two things and nothing else:
 *
 * <ul>
 *   <li>Every {@link HttpServer} of the JVM listens on the loopback address only, and every
 *       request has to carry the header {@value #TOKEN_HEADER} with the value of the
 *       environment variable {@code PROM4PY_TOKEN}; others get 403. A web page cannot set
 *       that header on a request to another origin without a preflight, which gets 403 as
 *       well. Done through the provider that {@link HttpServer#create} asks
 *       ({@code com.sun.net.httpserver.HttpServerProvider}), so ProM's code is unchanged.</li>
 *   <li>The JVM ends when its standard input closes, which the system does when the app's
 *       process ends for whatever reason: no ProM is left behind after a crash.</li>
 * </ul>
 *
 * <p>Compiled for Java 8 by {@code scripts/build_desktop.py prom}; uses no ProM class at
 * compile time.
 */
public final class LocalProM {

    /** The header that carries the token. */
    public static final String TOKEN_HEADER = "X-ProM4Py-Token";

    /** Seconds the JVM gets to exit by itself after its input closed, before it is halted. */
    private static final long HALT_AFTER_MS = 5000;

    private LocalProM() {
    }

    public static void main(String[] args) throws Throwable {
        String token = System.getenv("PROM4PY_TOKEN");
        if (token == null || token.length() < 16) {
            System.err.println("[launcher] PROM4PY_TOKEN is not set; ProM is not started without it.");
            System.exit(2);
        }
        System.setProperty("com.sun.net.httpserver.HttpServerProvider", Provider.class.getName());
        watchInput();
        try {
            Class.forName("org.processmining.contexts.prom4py.ProM4PY")
                    .getMethod("main", String[].class)
                    .invoke(null, (Object) args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }

    /** Ends the JVM once standard input reaches its end (the app closed it or is gone). */
    private static void watchInput() {
        Thread watcher = new Thread(() -> {
            try {
                byte[] buffer = new byte[256];
                while (System.in.read(buffer) >= 0) {
                    // The app writes nothing; this only waits for the end.
                }
            } catch (IOException e) {
                // A broken pipe ends the input as well.
            }
            System.err.println("[launcher] the app closed the connection; stopping ProM");
            Thread halt = new Thread(() -> {
                try {
                    Thread.sleep(HALT_AFTER_MS);
                } catch (InterruptedException ignored) {
                    // halt anyway
                }
                Runtime.getRuntime().halt(0);
            }, "prom-launcher-halt");
            halt.setDaemon(true);
            halt.start();
            System.exit(0);
        }, "prom-launcher-input");
        watcher.setDaemon(true);
        watcher.start();
    }

    /** {@link HttpServerProvider} of the JVM: the default servers, on loopback, behind the token. */
    public static final class Provider extends HttpServerProvider {
        private final HttpServerProvider inner;
        private final byte[] token;

        public Provider() throws ReflectiveOperationException {
            inner = (HttpServerProvider) Class.forName("sun.net.httpserver.DefaultHttpServerProvider").newInstance();
            token = System.getenv("PROM4PY_TOKEN").getBytes(StandardCharsets.UTF_8);
        }

        @Override
        public HttpServer createHttpServer(InetSocketAddress addr, int backlog) throws IOException {
            InetSocketAddress local = addr == null ? null : new InetSocketAddress(InetAddress.getLoopbackAddress(), addr.getPort());
            return new GuardedServer(inner.createHttpServer(local, backlog), new TokenFilter(token));
        }

        @Override
        public HttpsServer createHttpsServer(InetSocketAddress addr, int backlog) {
            throw new UnsupportedOperationException("ProM4Py in the desktop app serves plain HTTP on loopback only");
        }
    }

    /** Refuses every request without the right token, in constant time. */
    static final class TokenFilter extends Filter {
        private final byte[] token;

        TokenFilter(byte[] token) {
            this.token = token;
        }

        @Override
        public void doFilter(HttpExchange exchange, Chain chain) throws IOException {
            String given = exchange.getRequestHeaders().getFirst(TOKEN_HEADER);
            if (given != null && MessageDigest.isEqual(given.getBytes(StandardCharsets.UTF_8), token)) {
                chain.doFilter(exchange);
                return;
            }
            exchange.sendResponseHeaders(403, -1);
            exchange.close();
        }

        @Override
        public String description() {
            return "requires " + TOKEN_HEADER;
        }
    }

    /** A server that puts the token filter in front of every context. */
    static final class GuardedServer extends HttpServer {
        private final HttpServer inner;
        private final Filter filter;

        GuardedServer(HttpServer inner, Filter filter) {
            this.inner = inner;
            this.filter = filter;
        }

        @Override
        public void bind(InetSocketAddress addr, int backlog) throws IOException {
            inner.bind(addr == null ? null : new InetSocketAddress(InetAddress.getLoopbackAddress(), addr.getPort()), backlog);
        }

        @Override
        public void start() {
            inner.start();
        }

        @Override
        public void setExecutor(Executor executor) {
            inner.setExecutor(executor);
        }

        @Override
        public Executor getExecutor() {
            return inner.getExecutor();
        }

        @Override
        public void stop(int delay) {
            inner.stop(delay);
        }

        @Override
        public HttpContext createContext(String path, HttpHandler handler) {
            HttpContext context = inner.createContext(path, handler);
            context.getFilters().add(filter);
            return context;
        }

        @Override
        public HttpContext createContext(String path) {
            HttpContext context = inner.createContext(path);
            context.getFilters().add(filter);
            return context;
        }

        @Override
        public void removeContext(String path) {
            inner.removeContext(path);
        }

        @Override
        public void removeContext(HttpContext context) {
            inner.removeContext(context);
        }

        @Override
        public InetSocketAddress getAddress() {
            return inner.getAddress();
        }
    }
}
