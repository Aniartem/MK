package ru.mk.pos;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.Method;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Мост к «Драйверу ККТ 10» АТОЛ для Android.
 *
 * Драйвер (fptr10.aar / libfptr10.jar) распространяется АТОЛ по лицензии и не входит в репозиторий —
 * его нужно положить в pos/android/app/libs (см. README там). Классы драйвера вызываются через рефлексию,
 * поэтому приложение собирается и без него, а касса сообщает понятную ошибку.
 *
 * Касса отправляет сюда готовые JSON-задания драйвера (sell, openShift, closeShift, reportX...).
 */
@CapacitorPlugin(name = "Atol")
public class AtolPlugin extends Plugin {
    private static final String FPTR_CLASS = "ru.atol.drivers10.fptr.Fptr";
    private static final String IFPTR_CLASS = "ru.atol.drivers10.fptr.IFptr";

    // Драйвер не потокобезопасен: все обращения к ККТ — строго по очереди в одном потоке
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Object fptr;
    private Class<?> api;
    private String appliedSettings = "";

    @PluginMethod
    public void configure(PluginCall call) {
        String port = call.getString("port", "usb");
        String address = call.getString("address", "");
        worker.execute(() -> {
            try {
                ensureDriver();
                String key = port + "|" + address;
                if (!key.equals(appliedSettings)) {
                    invoke("close");
                    setting("LIBFPTR_SETTING_MODEL", constant("LIBFPTR_MODEL_ATOL_AUTO"));
                    if (port.equals("tcp")) {
                        String[] parts = address.split(":");
                        setting("LIBFPTR_SETTING_PORT", constant("LIBFPTR_PORT_TCPIP"));
                        setting("LIBFPTR_SETTING_IPADDRESS", parts[0]);
                        setting("LIBFPTR_SETTING_IPPORT", parts.length > 1 ? parts[1] : "5555");
                    } else if (port.equals("bluetooth")) {
                        setting("LIBFPTR_SETTING_PORT", constant("LIBFPTR_PORT_BLUETOOTH"));
                        setting("LIBFPTR_SETTING_MACADDRESS", address);
                    } else {
                        setting("LIBFPTR_SETTING_PORT", constant("LIBFPTR_PORT_USB"));
                        setting("LIBFPTR_SETTING_USB_DEVICE_PATH", "auto");
                    }
                    check(invoke("applySingleSettings"));
                    appliedSettings = key;
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(message(e));
            }
        });
    }

    @PluginMethod
    public void process(PluginCall call) {
        String task = call.getString("task");
        if (task == null) {
            call.reject("Пустое задание для ККТ");
            return;
        }
        worker.execute(() -> {
            try {
                ensureDriver();
                if (!Boolean.TRUE.equals(invoke("isOpened"))) check(invoke("open"));
                int json = Integer.parseInt(constant("LIBFPTR_PARAM_JSON_DATA"));
                api.getMethod("setParam", int.class, String.class).invoke(fptr, json, task);
                check(invoke("processJson"));
                Object result = api.getMethod("getParamString", int.class).invoke(fptr, json);
                JSObject ret = new JSObject();
                ret.put("result", result == null ? "" : result.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(message(e));
            }
        });
    }

    private void ensureDriver() throws Exception {
        if (fptr != null) return;
        Class<?> cls;
        try {
            cls = Class.forName(FPTR_CLASS);
            api = Class.forName(IFPTR_CLASS);
        } catch (ClassNotFoundException e) {
            throw new Exception("Драйвер АТОЛ не установлен в приложение. Добавьте fptr10 в pos/android/app/libs и пересоберите APK.");
        }
        fptr = cls.getConstructor(android.content.Context.class).newInstance(getContext().getApplicationContext());
    }

    private Object invoke(String name) throws Exception {
        Method m = api.getMethod(name);
        return m.invoke(fptr);
    }

    private void setting(String key, String value) throws Exception {
        api.getMethod("setSingleSetting", String.class, String.class).invoke(fptr, constant(key), value);
    }

    // Значения констант драйвера берём из него самого, а не зашиваем числа
    private String constant(String name) throws Exception {
        return String.valueOf(api.getField(name).get(null));
    }

    private void check(Object code) throws Exception {
        if (code instanceof Integer && (Integer) code != 0) {
            Object description = invoke("errorDescription");
            throw new Exception(description == null ? "Ошибка ККТ " + code : description.toString());
        }
    }

    private static String message(Exception e) {
        Throwable t = e instanceof java.lang.reflect.InvocationTargetException && e.getCause() != null ? e.getCause() : e;
        return t.getMessage() != null ? t.getMessage() : t.toString();
    }
}
