package com.wukong.ai;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Hashtable;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends Activity {

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, HttpURLConnection> running = new ConcurrentHashMap<>();
    private static final int REQ_PICK = 1001;

    /** 免密钥模型通道：无需 Token / API Key，匿名即可调用。 */
    private static final String API_URL = "https://text.pollinations.ai/openai";
    private static final String DEFAULT_MODEL = "openai";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    private void js(final String script) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(script, null);
            }
        });
    }

    private void callback(String fn, String... args) {
        StringBuilder sb = new StringBuilder("window.").append(fn).append(" && window.").append(fn).append("(");
        for (int i = 0; i < args.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(JSONObject.quote(args[i]));
        }
        sb.append(")");
        js(sb.toString());
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.__onBack && window.__onBack()) ? '1' : '0'", value -> {
            if (value == null || value.contains("0")) {
                finish();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            callback("__onImageCancel");
            return;
        }
        try {
            Uri uri = data.getData();
            Bitmap src = decodeSampled(uri, 1440);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            int q = 82;
            src.compress(Bitmap.CompressFormat.JPEG, q, bos);
            while (bos.size() > 3400 * 1024 && q > 40) {
                q -= 12;
                bos.reset();
                src.compress(Bitmap.CompressFormat.JPEG, q, bos);
            }
            src.recycle();
            String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
            callback("__onImagePicked", "data:image/jpeg;base64," + b64);
        } catch (Throwable t) {
            callback("__onImageCancel");
        }
    }

    private Bitmap decodeSampled(Uri uri, int maxSide) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        InputStream in = getContentResolver().openInputStream(uri);
        BitmapFactory.decodeStream(in, null, o);
        if (in != null) in.close();
        int scale = 1;
        int big = Math.max(o.outWidth, o.outHeight);
        while (big / scale > maxSide) scale *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = scale;
        InputStream in2 = getContentResolver().openInputStream(uri);
        Bitmap bm = BitmapFactory.decodeStream(in2, null, o2);
        if (in2 != null) in2.close();
        if (bm == null) throw new IllegalStateException("decode failed");
        int side = Math.min(bm.getWidth(), bm.getHeight());
        if (side > maxSide) {
            float r = (float) maxSide / side;
            Bitmap scaled = Bitmap.createScaledBitmap(bm, Math.round(bm.getWidth() * r), Math.round(bm.getHeight() * r), true);
            if (scaled != bm) bm.recycle();
            return scaled;
        }
        return bm;
    }

    // ------------------------------------------------------------------ bridge

    public class Bridge {

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public void toast(String msg) {
            ui.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void pickImage() {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.setType("image/*");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            try {
                startActivityForResult(Intent.createChooser(intent, "选择图片"), REQ_PICK);
            } catch (Throwable t) {
                callback("__onImageCancel");
            }
        }

        /**
         * 生成登录二维码，返回 data:image/png;base64 字符串，纯本地离线渲染。
         */
        @JavascriptInterface
        public String makeQr(String content, int size) {
            try {
                Hashtable<EncodeHintType, Object> hints = new Hashtable<>();
                hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
                hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
                hints.put(EncodeHintType.MARGIN, 2);
                com.google.zxing.common.BitMatrix matrix =
                        new QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size, hints);
                Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
                for (int x = 0; x < size; x++) {
                    for (int y = 0; y < size; y++) {
                        bmp.setPixel(x, y, matrix.get(x, y) ? 0xFF11182A : 0xFFFFFFFF);
                    }
                }
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.PNG, 100, bos);
                bmp.recycle();
                return "data:image/png;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
            } catch (Throwable t) {
                return "";
            }
        }

        /** 停止某条正在生成的回答 */
        @JavascriptInterface
        public void stopChat(String id) {
            HttpURLConnection c = running.remove(id);
            if (c != null) {
                try { c.disconnect(); } catch (Throwable ignored) { }
            }
            callback("__aiStopped", id);
        }

        /**
         * 调用 GitHub AI Models（OpenAI 兼容）流式接口。
         */
        @JavascriptInterface
        public void chat(final String payload) {
            final JSONObject p;
            try {
                p = new JSONObject(payload);
            } catch (Exception e) {
                return;
            }
            final String id = p.optString("id");
            final String model = p.optString("model", DEFAULT_MODEL);
            final String mode = p.optString("mode", "standard");
            final String image = p.optString("image", "");
            final JSONArray msgs = p.optJSONArray("messages");
            final String imageNote = p.optString("imageNote", "");

            new Thread(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection conn = null;
                    try {
                        JSONObject body = new JSONObject();
                        body.put("model", model);
                        body.put("stream", true);
                        body.put("temperature", mode.equals("advanced") ? 0.5 : 0.7);
                        body.put("max_tokens", mode.equals("advanced") ? 2400 : 1000);

                        JSONArray out = new JSONArray();
                        if (mode.equals("advanced")) {
                            JSONObject sys = new JSONObject();
                            sys.put("role", "system");
                            sys.put("content", "你是「悟空」，钉钉生态里的 AI 工作助手。回答要做到：先给出结论或可执行方案，再补充关键展开；逻辑完整、条理清晰，适当使用分点或短表格；涉及数据、代码、步骤时保证准确；用中文回答；不要编造事实，不确定时直接说明。");
                            out.put(sys);
                        }
                        if (msgs != null) {
                            for (int i = 0; i < msgs.length(); i++) {
                                JSONObject m = msgs.getJSONObject(i);
                                String role = m.optString("role", "user");
                                String content = m.optString("content", "");
                                boolean last = (i == msgs.length() - 1);
                                JSONObject msg = new JSONObject();
                                msg.put("role", role);
                                if (last && role.equals("user") && (!image.isEmpty() || !imageNote.isEmpty())) {
                                    String ask = content.isEmpty() ? "请帮我解读这张图片。" : content;
                                    msg.put("content", ask + "\n\n【用户刚上传了一张图片，本机已做本地解析】：" + imageNote
                                            + "\n请基于这些图像信息直接给出解读与建议；不要声称你看到了图片像素细节，也不要编造图中文字。");
                                } else {
                                    msg.put("content", content);
                                }
                                out.put(msg);
                            }
                        }
                        body.put("messages", out);

                        boolean anyDelta = false;
                        String lastErr = "";
                        int waitSeconds = 0;

                        for (int attempt = 0; attempt < 3; attempt++) {
                            HttpURLConnection c = null;
                            try {
                                if (waitSeconds > 0) {
                                    callback("__aiWait", id, String.valueOf(waitSeconds));
                                    Thread.sleep((waitSeconds + 2L) * 1000L);
                                    callback("__aiWait", id, "0");
                                }
                                body.put("model", model);
                                URL url = new URL(API_URL);
                                c = (HttpURLConnection) url.openConnection();
                                c.setRequestMethod("POST");
                                c.setConnectTimeout(20000);
                                c.setReadTimeout(90000);
                                c.setDoOutput(true);
                                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                                c.setRequestProperty("Accept", "text/event-stream");
                                c.setRequestProperty("User-Agent", "WukongAndroid/1.1");
                                running.put(id, c);

                                OutputStream os = c.getOutputStream();
                                os.write(body.toString().getBytes("UTF-8"));
                                os.flush();
                                os.close();

                                int code = c.getResponseCode();
                                if (code != 200) {
                                    String raw = readAll(c.getErrorStream());
                                    lastErr = humanError(raw, code);
                                    running.remove(id);
                                    try { c.disconnect(); } catch (Throwable ignored) { }
                                    int w = parseRetryAfter(raw);
                                    if ((code == 402 || code == 429) && w > 0 && attempt < 2) {
                                        waitSeconds = w;
                                        continue;
                                    }
                                    break;
                                }

                                BufferedReader rd = new BufferedReader(
                                        new InputStreamReader(c.getInputStream(), "UTF-8"));
                                String line;
                                while ((line = rd.readLine()) != null) {
                                    if (line.isEmpty()) continue;
                                    if (!line.startsWith("data:")) continue;
                                    String data = line.substring(5).trim();
                                    if ("[DONE]".equals(data)) break;
                                    try {
                                        JSONObject chunk = new JSONObject(data);
                                        JSONArray choices = chunk.optJSONArray("choices");
                                        if (choices == null || choices.length() == 0) continue;
                                        JSONObject delta = choices.getJSONObject(0).optJSONObject("delta");
                                        if (delta == null) continue;
                                        String piece = delta.optString("content", "");
                                        if (!piece.isEmpty()) {
                                            anyDelta = true;
                                            callback("__aiDelta", id, piece);
                                        }
                                    } catch (Exception ignored) {
                                    }
                                }
                                rd.close();
                                running.remove(id);
                                try { c.disconnect(); } catch (Throwable ignored) { }
                                c = null;
                                anyDelta = true;
                                break;
                            } catch (Throwable t2) {
                                lastErr = "网络异常：" + t2.getClass().getSimpleName();
                                running.remove(id);
                                try { if (c != null) c.disconnect(); } catch (Throwable ignored) { }
                                c = null;
                                break;
                            }
                        }

                        if (!anyDelta) {
                            callback("__aiError", id, lastErr.isEmpty() ? "请求失败，请检查网络后重试" : lastErr);
                            return;
                        }
                        callback("__aiDone", id);
                    } catch (Throwable t) {
                        boolean cancelled = running.remove(id) == null;
                        if (conn != null) {
                            try { conn.disconnect(); } catch (Throwable ignored) { }
                        }
                        if (!cancelled) {
                            callback("__aiError", id, "网络异常：" + t.getClass().getSimpleName());
                        }
                    }
                }
            }).start();
        }
    }

    private static String readAll(InputStream in) {
        if (in == null) return "";
        try {
            BufferedReader rd = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = rd.readLine()) != null) sb.append(line);
            rd.close();
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    /** 从限流响应里解析需要等待的秒数。 */
    private static int parseRetryAfter(String raw) {
        if (raw == null) return 0;
        try {
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("(?i)retry after\\s*(\\d+)").matcher(raw);
            if (m.find()) return Integer.parseInt(m.group(1));
            m = java.util.regex.Pattern.compile("(?i)^(\\d+)\\s*$").matcher(raw.trim());
            if (m.find()) return Integer.parseInt(m.group(1));
        } catch (Throwable ignored) {
        }
        return 0;
    }

    private static String humanError(String raw, int code) {
        String msg = "";
        try {
            JSONObject o = new JSONObject(raw);
            if (o.has("error")) {
                Object e = o.get("error");
                if (e instanceof JSONObject) msg = ((JSONObject) e).optString("message", "");
                else msg = String.valueOf(e);
            } else {
                msg = o.optString("message", "");
            }
        } catch (Exception ignored) {
            msg = raw;
        }
        if (msg == null) msg = "";
        if (msg.length() > 180) msg = msg.substring(0, 180) + "…";
        switch (code) {
            case 401:
                return "Token 无效或已过期，请在「设置」里重新填写 GitHub Token（需带 models 权限）";
            case 403:
                return "没有权限访问该模型，请确认 Token 权限或换一个模型" + (msg.isEmpty() ? "" : "（" + msg + "）");
            case 404:
                return "模型不存在，请检查模型名称" + (msg.isEmpty() ? "" : "（" + msg + "）");
            case 402:
            case 429:
                return "免费通道正忙（每 45 秒 1 次免费额度），已自动排队重试" + (msg.isEmpty() ? "" : "（" + msg + "）");
            default:
                return msg.isEmpty() ? ("请求失败（HTTP " + code + "）") : msg;
        }
    }

    private static class BitMatrixHolder {
    }
}
