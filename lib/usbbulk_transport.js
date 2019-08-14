var usb         = require('usb');
var stream      = require('stream');
var events      = require('events');


function usbbulk(){
    var self =  new events.EventEmitter();
    usb.on('error', function( err){
        self.emit('error',err)
    })
    function findDevice(vid, pid) {
        function filterDevice(device){
            return ( device.deviceDescriptor.idVendor === vid && 
                     device.deviceDescriptor.idProduct === pid )
        }
        return usb.getDeviceList().filter(filterDevice)[0];
    }
    function findIntf(interfaces, bInterfaceClass, bInterfaceSubClass){
        function filterIntf(intf){
            return ( intf.descriptor.bInterfaceClass === bInterfaceClass && 
                     intf.descriptor.bInterfaceSubClass === bInterfaceSubClass )
        }
        return interfaces.filter(filterIntf)
    }
    function findEp(intf, transferType, direction) {
        function filterEp(ep){
            return ( ep.transferType === transferType && 
                     ep.direction === direction )
        }
        return intf.endpoints.filter(filterEp)[0]
    }
    
    self.start = function(vid,pid){
        var device,cdc,custom;
            vid = vid||0x1209
            pid = pid||0x0D32
            device = findDevice(0x1209,0x0D32)// Generic, ODrive Robotics ODrive v3
            if(!device){
                self.emit('log', {'info': new Date() + ' : No device found. Scanning for Odrive'})
                setTimeout(function(){
                    self.start(vid, pid)
                },1000)
            }else{
                device.open()
                self.emit('device',device)
                self.emit('log', {
                    'info': new Date() + ' : Found Odrive. Scanning ' + device.interfaces.length  + 'interfaces' 
                    
                })
                cdc     = findIntf(device.interfaces,0x0a, 0x00)[0]  
                custom  = findIntf(device.interfaces,0x00, 0x01)[0] 
                
                cdc.isKernelDriverActive()?   cdc.detachKernelDriver()  : null;
                custom.isKernelDriverActive()?  custom.detachKernelDriver() : null;
                
                cdc.in     = findEp(cdc , usb.LIBUSB_TRANSFER_TYPE_BULK, 'in');
                cdc.out    = findEp(cdc , usb.LIBUSB_TRANSFER_TYPE_BULK, 'out');
                
                cdc.in.on('error', function(err){
                    self.emit('error',err)
                })
                cdc.out.on('error', function(err){
                    self.emit('error',err)
                })
                
                custom.in     = findEp(custom , usb.LIBUSB_TRANSFER_TYPE_BULK, 'in');
                custom.out    = findEp(custom , usb.LIBUSB_TRANSFER_TYPE_BULK, 'out');
                
                custom.in.on('error', function(err){
                    self.emit('error',err)
                })
                custom.out.on('error', function(err){
                    self.emit('error',err)
                })
                
                cdc.in.startPoll();
                custom.in.startPoll();
                
                self.cdc = new stream.Duplex({
                    read:function(size){ },
                    write:function(chunk, encoding, callback){
                        cdc.out.transfer(chunk)
                        callback()
                    }
                } )
                cdc.in.on('data' ,function(data){
                    self.cdc.push(data)
                })
                
                self.custom = new stream.Duplex({
                    read:function(size){ },
                    write:function(chunk, encoding, callback){
                        custom.out.transfer(chunk)
                        callback()
                    }
                } )
                custom.in.on('data' ,function(data){
                    self.custom.push(data)
                })
                self.emit('log', {
                    'info': new Date() + ' : USB bulk transport ready.'
                    
                })
                self.emit('connect')
            }
            
        
        
    }
    
    return self
}
module.exports = usbbulk 