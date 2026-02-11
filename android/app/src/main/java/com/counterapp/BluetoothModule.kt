package com.counterapp

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.ActivityCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.IOException
import java.io.OutputStream
import java.util.*

class BluetoothModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private var bluetoothSocket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null
    private var connectedAddress: String? = null

    // UUID for Serial Port Profile (SPP)
    private val MY_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val action: String? = intent.action
            when(action) {
                BluetoothDevice.ACTION_FOUND -> {
                    val device: BluetoothDevice? = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    device?.let {
                        if (checkBluetoothConnectPermission()) {
                            val params = Arguments.createMap()
                            params.putString("name", it.name ?: "Unknown Device")
                            params.putString("address", it.address)
                            params.putBoolean("bonded", it.bondState == BluetoothDevice.BOND_BONDED)
                            sendEvent("DeviceFound", params)
                        }
                    }
                }
                BluetoothDevice.ACTION_BOND_STATE_CHANGED -> {
                    val device: BluetoothDevice? = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    val bondState = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE)
                    device?.let {
                         val params = Arguments.createMap()
                         params.putString("name", it.name ?: "Unknown Device")
                         params.putString("address", it.address)
                         params.putString("bondState", when(bondState) {
                             BluetoothDevice.BOND_BONDED -> "bonded"
                             BluetoothDevice.BOND_BONDING -> "bonding"
                             else -> "none"
                         })
                         sendEvent("DeviceBondStateChanged", params)
                    }
                }
            }
        }
    }
    
    private fun checkBluetoothConnectPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActivityCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    override fun getName(): String {
        return "BluetoothModule"
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactApplicationContext.hasActiveCatalystInstance()) {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    @ReactMethod
    fun getPairedDevices(promise: Promise) {
        if (bluetoothAdapter == null) {
            promise.reject("BLUETOOTH_UNAVAILABLE", "Bluetooth is not supported on this device")
            return
        }

        if (!checkBluetoothConnectPermission()) {
             promise.reject("PERMISSION_DENIED", "Bluetooth connect permission denied")
             return
        }

        val bondedDevices = bluetoothAdapter.bondedDevices
        val result = Arguments.createArray()
        bondedDevices.forEach { device ->
            val map = Arguments.createMap()
            map.putString("name", device.name ?: "Unknown Device")
            map.putString("address", device.address)
            map.putBoolean("bonded", true)
            result.pushMap(map)
        }
        promise.resolve(result)
    }
    
    @ReactMethod
    fun pairDevice(address: String, promise: Promise) {
        if (bluetoothAdapter == null) {
            promise.reject("BLUETOOTH_UNAVAILABLE", "Bluetooth not supported")
            return
        }
        
        try {
            val device = bluetoothAdapter.getRemoteDevice(address)
             if (!checkBluetoothConnectPermission()) {
                 promise.reject("PERMISSION_DENIED", "Connect permission denied")
                 return
            }

            if (device.bondState == BluetoothDevice.BOND_BONDED) {
                promise.resolve("Already paired")
            } else {
                // For modern Android, createBond() needs BLUETOOTH_CONNECT permission which we checked
                val result = device.createBond()
                if (result) {
                    promise.resolve("Pairing initiated")
                } else {
                    promise.reject("PAIRING_FAILED", "Could not initiate pairing")
                }
            }
        } catch (e: Exception) {
            promise.reject("PAIRING_ERROR", e.message)
        }
    }

    @ReactMethod
    fun startScan(promise: Promise) {
        if (bluetoothAdapter == null) {
            promise.reject("BLUETOOTH_UNAVAILABLE", "Bluetooth is not supported on this device")
            return
        }

        if (!bluetoothAdapter.isEnabled) {
             promise.reject("BLUETOOTH_DISABLED", "Bluetooth is disabled")
             return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
             if (ActivityCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                 promise.reject("PERMISSION_DENIED", "Bluetooth scan permission denied")
                 return
             }
        } else {
             if (ActivityCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                 promise.reject("PERMISSION_DENIED", "Location permission denied")
                 return
             }
        }

        val filter = IntentFilter()
        filter.addAction(BluetoothDevice.ACTION_FOUND)
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
        
        try {
             try {
                reactApplicationContext.unregisterReceiver(receiver)
             } catch(e: Exception) { /* ignore */ }
             
             reactApplicationContext.registerReceiver(receiver, filter)
             
             if (bluetoothAdapter.isDiscovering) {
                 bluetoothAdapter.cancelDiscovery()
             }
             
             bluetoothAdapter.startDiscovery()
             promise.resolve("Scan started")
        } catch (e: Exception) {
             promise.reject("SCAN_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopScan(promise: Promise) {
        try {
            if (bluetoothAdapter?.isDiscovering == true) {
                if (ActivityCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
                    bluetoothAdapter.cancelDiscovery()
                }
            }
            try {
                reactApplicationContext.unregisterReceiver(receiver)
            } catch (e: IllegalArgumentException) {
                // Receiver not registered
            }
            promise.resolve("Scan stopped")
        } catch (e: Exception) {
            promise.reject("STOP_SCAN_ERROR", e.message)
        }
    }

    @ReactMethod
    fun connect(address: String, promise: Promise) {
        if (bluetoothAdapter == null) {
             promise.reject("BLUETOOTH_UNAVAILABLE", "Bluetooth not supported")
             return
        }
        
        if (address == connectedAddress && bluetoothSocket?.isConnected == true) {
             promise.resolve("Already connected to ${address}")
             return
        }
        
        try {
            val device = bluetoothAdapter.getRemoteDevice(address)
            
            if (!checkBluetoothConnectPermission()) {
                 promise.reject("PERMISSION_DENIED", "Connect permission denied")
                 return
            }
            
            // Cancel discovery
            if (bluetoothAdapter.isDiscovering) {
                 if (ActivityCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
                    bluetoothAdapter.cancelDiscovery()
                }
            }

            // Close existing socket if we are connecting to a NEW device
            if (bluetoothSocket?.isConnected == true) {
                 try {
                     bluetoothSocket?.close()
                 } catch (e: Exception) { /* ignore */ }
            }

            // Try standard secure connection first
            try {
                bluetoothSocket = device.createRfcommSocketToServiceRecord(MY_UUID)
                bluetoothSocket?.connect()
            } catch (e: IOException) {
                Log.w("BluetoothModule", "Socket creation failed, trying fallback...")
                // Fallback approach: reflection to call createRfcommSocket
                try {
                    val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
                    bluetoothSocket = method.invoke(device, 1) as BluetoothSocket
                    bluetoothSocket?.connect()
                } catch (e2: Exception) {
                     Log.e("BluetoothModule", "Fallback failed too", e2)
                     throw IOException("Could not connect to device: ${e.message}")
                }
            }
            
            outputStream = bluetoothSocket?.outputStream
            connectedAddress = address
            promise.resolve("Connected to ${device.name}")
        } catch (e: IOException) {
            try {
                bluetoothSocket?.close()
            } catch (closeException: IOException) {
                Log.e("BluetoothModule", "Could not close the client socket", closeException)
            }
            connectedAddress = null
            promise.reject("CONNECTION_FAILED", e.message)
        } catch (e: Exception) {
            connectedAddress = null
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun sendData(message: String, promise: Promise) {
        if (outputStream == null) {
            promise.reject("NOT_CONNECTED", "No active connection")
            return
        }
        
        try {
            outputStream?.write(message.toByteArray())
            promise.resolve("Data sent")
        } catch (e: IOException) {
            promise.reject("SEND_FAILED", "Error sending data: ${e.message}")
        }
    }
    
    @ReactMethod
    fun disconnect(promise: Promise) {
        try {
            outputStream?.close()
            bluetoothSocket?.close()
            outputStream = null
            bluetoothSocket = null
            promise.resolve("Disconnected")
        } catch (e: IOException) {
            promise.reject("DISCONNECT_ERROR", e.message)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
