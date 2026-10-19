package ru.mk.pos;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Локальные плагины регистрируются до запуска моста
        registerPlugin(AtolPlugin.class);
        super.onCreate(savedInstanceState);
        // С Android 12 доступ к Bluetooth-ККТ нужно запросить у пользователя
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.BLUETOOTH_CONNECT }, 1);
        }
    }
}
