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

    private val PREFS_NAME = "BluetoothPrefs"
    private val KEY_LAST_ADDRESS = "last_printer_address"
    private val KEY_LAST_NAME = "last_printer_name"

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
                    val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= 33) {
                         intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                         intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
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
                    val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= 33) {
                         intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                         intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
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
                BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                     val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= 33) {
                         intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                         intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                     if (device?.address == connectedAddress) {
                         bluetoothSocket = null
                         outputStream = null
                         connectedAddress = null
                         sendEvent("DeviceDisconnected", null)
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
        filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
        
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
    fun printTestReceipt(promise: Promise) {
        if (outputStream == null) {
            promise.reject("NOT_CONNECTED", "No active connection to printer")
            return
        }

        try {
            val os = outputStream!!
            
            // ESC/POS Commands
            val ESC = 0x1B.toByte()
            val GS = 0x1D.toByte()
            val ENTER = 0x0A.toByte()
            
            val reset = byteArrayOf(ESC, '@'.toByte())
            val alignCenter = byteArrayOf(ESC, 'a'.toByte(), 1)
            val alignLeft = byteArrayOf(ESC, 'a'.toByte(), 0)
            val boldOn = byteArrayOf(ESC, 'E'.toByte(), 1)
            val boldOff = byteArrayOf(ESC, 'E'.toByte(), 0)
            val doubleHeight = byteArrayOf(GS, '!'.toByte(), 0x10) // Double height
            val normalSize = byteArrayOf(GS, '!'.toByte(), 0x00)
            val feed = byteArrayOf(ESC, 'd'.toByte(), 3) // Feed 3 lines
            
            // Print Content
            os.write(reset)
            
            // Title
            os.write(alignCenter)
            os.write(boldOn)
            os.write(doubleHeight)
            os.write("TEST RECEIPT".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write(normalSize)
            os.write(boldOff)
            os.write(byteArrayOf(ENTER))
            
            // Body
            os.write(alignLeft)
            os.write("Printer Connection Successful!".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("--------------------------------".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("Date: ${java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())}".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write(byteArrayOf(ENTER))
            os.write("Thank you for using".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("Native Bluetooth Module".toByteArray())
            os.write(byteArrayOf(ENTER))
            
            // Feed and Cut (if supported, or just feed)
            os.write(feed)
            
            promise.resolve("Test receipt printed")
        } catch (e: Exception) {
            promise.reject("PRINT_ERROR", "Failed to print test receipt: ${e.message}")
        }
    }

    @ReactMethod
    fun printInvoice(promise: Promise) {
        if (outputStream == null) {
            promise.reject("NOT_CONNECTED", "No active connection to printer")
            return
        }

        try {
            val os = outputStream!!
            
            // ESC/POS Commands
            val ESC = 0x1B.toByte()
            val GS = 0x1D.toByte()
            val ENTER = 0x0A.toByte()
            
            val reset = byteArrayOf(ESC, '@'.toByte())
            val alignCenter = byteArrayOf(ESC, 'a'.toByte(), 1)
            val alignLeft = byteArrayOf(ESC, 'a'.toByte(), 0)
            val alignRight = byteArrayOf(ESC, 'a'.toByte(), 2)
            val boldOn = byteArrayOf(ESC, 'E'.toByte(), 1)
            val boldOff = byteArrayOf(ESC, 'E'.toByte(), 0)
            val doubleHeight = byteArrayOf(GS, '!'.toByte(), 0x10)
            val normalSize = byteArrayOf(GS, '!'.toByte(), 0x00)
            val feed = byteArrayOf(ESC, 'd'.toByte(), 3)
            
            os.write(reset)
            
            // Header
            os.write(alignCenter)
            os.write(boldOn)
            os.write(doubleHeight)
            os.write("RESTAURANT INVOICE".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write(normalSize)
            os.write(boldOff)
            os.write("123 Food Street, City".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("Tel: +123 456 7890".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write(byteArrayOf(ENTER))
            
            // Invoice Details
            os.write(alignLeft)
            os.write("Inv #: 1001".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("Date: ${java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.getDefault()).format(java.util.Date())}".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("--------------------------------".toByteArray())
            os.write(byteArrayOf(ENTER))
            
            // Items
            os.write("Item            Qty    Price".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("--------------------------------".toByteArray())
            os.write(byteArrayOf(ENTER))
            
            os.write("Burger          2      20.00".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("Pizza           1      15.00".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("Coke            3       6.00".toByteArray())
            os.write(byteArrayOf(ENTER))
            
            os.write("--------------------------------".toByteArray())
            os.write(byteArrayOf(ENTER))
            
            // Total
            os.write(alignRight)
            os.write(boldOn)
            os.write("TOTAL: $41.00".toByteArray())
            os.write(boldOff)
            os.write(byteArrayOf(ENTER))
            os.write(byteArrayOf(ENTER))
            
            // Footer
            os.write(alignCenter)
            os.write("Thank you for dining with us!".toByteArray())
            os.write(byteArrayOf(ENTER))
            
            os.write(feed)
            
            promise.resolve("Invoice printed")
        } catch (e: Exception) {
            promise.reject("PRINT_ERROR", "Failed to print invoice: ${e.message}")
        }
    }

    @ReactMethod
    fun printKOT(promise: Promise) {
        if (outputStream == null) {
            promise.reject("NOT_CONNECTED", "No active connection to printer")
            return
        }

        try {
            val os = outputStream!!
            
            // ESC/POS Commands
            val ESC = 0x1B.toByte()
            val GS = 0x1D.toByte()
            val ENTER = 0x0A.toByte()
            
            val reset = byteArrayOf(ESC, '@'.toByte())
            val alignCenter = byteArrayOf(ESC, 'a'.toByte(), 1)
            val alignLeft = byteArrayOf(ESC, 'a'.toByte(), 0)
            val boldOn = byteArrayOf(ESC, 'E'.toByte(), 1)
            val boldOff = byteArrayOf(ESC, 'E'.toByte(), 0)
            val doubleHeightWidth = byteArrayOf(GS, '!'.toByte(), 0x11) // Double height & width
            val normalSize = byteArrayOf(GS, '!'.toByte(), 0x00)
            val feed = byteArrayOf(ESC, 'd'.toByte(), 3)
            
            os.write(reset)
            
            // Header
            os.write(alignCenter)
            os.write(boldOn)
            os.write(doubleHeightWidth)
            os.write("KOT".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write(normalSize)
            os.write("Kitchen Order Ticket".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write(byteArrayOf(ENTER))
            
            // Details
            os.write(alignLeft)
            os.write(boldOn)
            os.write("Table: 5".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("Server: John".toByteArray())
            os.write(boldOff)
            os.write(byteArrayOf(ENTER))
            os.write("Time: ${java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date())}".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("--------------------------------".toByteArray())
            os.write(byteArrayOf(ENTER))
            
            // Items
            os.write(boldOn)
            os.write("2 x Burger".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("  - No Onion".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("1 x Pizza".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write("3 x Coke".toByteArray())
            os.write(byteArrayOf(ENTER))
            os.write(boldOff)
            
            os.write(byteArrayOf(ENTER))
            os.write("--------------------------------".toByteArray())
            os.write(byteArrayOf(ENTER))
            
            os.write(feed)
            
            promise.resolve("KOT printed")
        } catch (e: Exception) {
            promise.reject("PRINT_ERROR", "Failed to print KOT: ${e.message}")
        }
    }

    @ReactMethod
    fun printRawData(base64Data: String, promise: Promise) {
        if (outputStream == null) {
            promise.reject("NOT_CONNECTED", "No active connection to printer")
            return
        }

        try {
            val decodedBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
            outputStream?.write(decodedBytes)
            promise.resolve("Data sent")
        } catch (e: Exception) {
            promise.reject("PRINT_ERROR", "Failed to send raw data: ${e.message}")
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
    fun saveLastPrinter(address: String, name: String, promise: Promise) {
        val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_LAST_ADDRESS, address).putString(KEY_LAST_NAME, name).apply()
        promise.resolve(true)
    }

    @ReactMethod
    fun getLastPrinter(promise: Promise) {
        val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val address = prefs.getString(KEY_LAST_ADDRESS, null)
        val name = prefs.getString(KEY_LAST_NAME, null)
        if (address != null) {
            val map = Arguments.createMap()
            map.putString("address", address)
            map.putString("name", name)
            promise.resolve(map)
        } else {
            promise.resolve(null)
        }
    }
    
    @ReactMethod
    fun clearLastPrinter(promise: Promise) {
        val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_LAST_ADDRESS).remove(KEY_LAST_NAME).apply()
        promise.resolve(true)
    }

    @ReactMethod
    fun isBluetoothEnabled(promise: Promise) {
        if (bluetoothAdapter == null) {
            promise.resolve(false)
        } else {
            promise.resolve(bluetoothAdapter.isEnabled)
        }
    }

    @ReactMethod
    fun isConnected(promise: Promise) {
        promise.resolve(bluetoothSocket?.isConnected == true)
    }

    @ReactMethod
    fun getConnectedDevice(promise: Promise) {
        if (bluetoothSocket?.isConnected == true && connectedAddress != null) {
            try {
                val device = bluetoothAdapter?.getRemoteDevice(connectedAddress)
                val map = Arguments.createMap()
                map.putString("name", device?.name ?: "Unknown Device")
                map.putString("address", connectedAddress)
                promise.resolve(map)
            } catch (e: Exception) {
                promise.resolve(null)
            }
        } else {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun isAnySysConnected(promise: Promise) {
        if (bluetoothAdapter == null) {
            promise.resolve(false)
            return
        }
        try {
            if (!checkBluetoothConnectPermission()) {
                 promise.resolve(false)
                 return
            }
            
            val bondedDevices = bluetoothAdapter.bondedDevices
            var isAnyConnected = false
            
            for (device in bondedDevices) {
                try {
                    val isConnectedMethod = device.javaClass.getMethod("isConnected")
                    val isConnected = isConnectedMethod.invoke(device) as Boolean
                    if (isConnected) {
                        isAnyConnected = true
                        break
                    }
                } catch (e: Exception) {
                    // Ignore
                }
            }
            
            promise.resolve(isAnyConnected)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getSystemConnectedPairedDevices(promise: Promise) {
        if (bluetoothAdapter == null) {
            promise.resolve(Arguments.createArray())
            return
        }
        
        if (!checkBluetoothConnectPermission()) {
             promise.reject("PERMISSION_DENIED", "Bluetooth connect permission denied")
             return
        }

        val result = Arguments.createArray()
        val bondedDevices = bluetoothAdapter.bondedDevices
        
        bondedDevices.forEach { device ->
            try {
                // Use reflection to call hidden isConnected() method
                val isConnectedMethod = device.javaClass.getMethod("isConnected")
                val isConnected = isConnectedMethod.invoke(device) as Boolean
                
                if (isConnected) {
                    val map = Arguments.createMap()
                    map.putString("name", device.name ?: "Unknown Device")
                    map.putString("address", device.address)
                    map.putBoolean("bonded", true)
                    result.pushMap(map)
                }
            } catch (e: Exception) {
                // Method might not exist on some devices or security restrictions
            }
        }
        promise.resolve(result)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
