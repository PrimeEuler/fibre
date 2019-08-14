var stream      = require('stream');
var usbbulk     = require('./usbbulk_transport.js');
function fibre(){
    var SYNC_BYTE           = 0xAA;
    var CRC8_INIT           = 0x42;
    var CRC16_INIT          = 0x1337;
    var PROTOCOL_VERSION    = 1;
    var CRC8_DEFAULT        = 0x37;
    var CRC16_DEFAULT       = 0x3d65;
    var MAX_PACKET_SIZE     = 128;
    var self    = new usbbulk()
        self.latency = [];
        self.json_crc = 0x5933;
        self.set_json_crc = function(crc){
            self.json_crc = crc
        }
        function get_json_crc(){
            return (self.json_crc - 0)
        }
    var isReady = true
    var queue = { 
        ready:function(){
            return isReady
        },
        sequence:0
        
    }
    var source = [];
    function calc_crc(remainder, value, polynomial, bitwidth){
       var topbit = (1 << (bitwidth - 1))
        remainder ^= (value << (bitwidth - 8))
        for(var b = 0; b<8; b++){
            if (remainder & topbit){
                remainder = (remainder << 1) ^ polynomial
            }else{
                remainder = (remainder << 1)
            }
        }
        return remainder & ((1 << bitwidth) - 1)
    }
    function calc_crc8(remainder, value){
        for(var b = 0; b<value.length; b++){
            remainder = calc_crc(remainder, value[b], CRC8_DEFAULT, 8)
        }
        return remainder
    }
    function calc_crc16(remainder, value){
        for(var b = 0; b<value.length; b++){
            remainder = calc_crc(remainder, value[b], CRC16_DEFAULT, 16)
        }
        return remainder
    }
    function txloop(){
        if(source.length > 0 && queue.ready()===true){
            
            var buffer          = source.pop()
            var sequence        = buffer.readUInt16LE(0);
            if(!queue[sequence]){
                //blackhole deleted operation
                //console.log('! sequence',sequence)
            }else{
                isReady             = false
                queue[sequence].ts  = process.hrtime()
                self.custom.write(buffer)
                self.emit('tx', queue[sequence] )
            }
        }
        setTimeout(txloop,0)
    }
    function nextSequence(){
        queue.sequence ++ 
        return queue.sequence - 0
    }
    function packet(){
        var self            = this
            self.sequence   = 0;
            self.id         = 0;
            self.size       = 0;
            self.payload    = Buffer.alloc(0);
            self.crc        = get_json_crc;
        return self
    }
    function connect(){
        txloop();
        self.cdc.on('data',console.log)
        self.custom.on('data',Response)
    }
    function Response(data){
        var buffer      = Buffer.from(data)
        var sequence    = (buffer.readUInt16LE(0) & 0x7fff) //(set MSB 0)
        var payload     = Buffer.alloc( buffer.length - 2 )
        var operation   = queue[sequence] 
            operation.acked = true
            self.latency.push( process.hrtime( queue[sequence].ts ) );
            if(self.latency.length > 30){
                self.latency = self.latency.slice(self.latency.length - 30)
            }
            if(sequence !== operation.sequence){ 
                self.emit('error', new Error(sequence + '!=' + operation.sequence) );
                return;
            }
            if((queue[sequence].id & 0x7fff) !== operation.id){
                self.emit('error', new Error(queue[sequence].id + '!=' + operation.id) );
                return;
            }
            buffer.copy( payload, 0, 2, buffer.length )
            operation.payload = Buffer.concat([ operation.payload, payload ])
            isReady = true
            if( operation.id === 0 ){
                if(payload.length > 0){
                    self.emit('payload.update', operation.payload.length)
                    source.unshift(Request(operation))
                }else{
                    self.emit('payload.complete', operation.payload.length)
                    var buf = new Buffer.alloc(2)
                        buf.writeInt16BE(calc_crc16(PROTOCOL_VERSION, operation.payload) )
                        self.json_crc = buf.readInt16LE(0)
                        operation.callback( Buffer.from(operation.payload) )
                }
            }else{
                operation.callback( Buffer.from( payload) )
            }

            delete queue[sequence];
            if(Object.keys(queue).length===2){ self.emit('ready') }   
    }
    function Request(operation){
        var ack     = true;
        var id      = operation.id - 0;
        var header  = Buffer.alloc(6) ;
        var payload = Buffer.alloc(0);
        var trailer = Buffer.alloc(2);
            if (ack){  id = (id|0x8000) ;} //(MSB 1 )
            operation.sequence = ((nextSequence() + 1) & 0x7fff);//bitwise and (MSB 0)

            header.writeUInt16LE(operation.sequence, 0);
            header.writeUInt16LE(id,  2);
            header.writeUInt16LE(operation.size, 4);

            if ((id & 0x7fff) === 0){
                payload = Buffer.alloc(4);
                payload.writeUInt32LE(operation.payload.length)
                trailer.writeUInt16LE(1,0)
            }else{
                payload = Buffer.from( operation.payload )
                trailer.writeUInt16BE( operation.crc() )
            }
            queue[operation.sequence] = operation 
        return Buffer.concat([header,payload,trailer])
    }
    function get_endpoint(id,size,callback){
        var operation           = new packet();
            operation.id        = id - 0;
            operation.size      = size - 0;
            operation.request   = 'get';
            operation.callback  = callback;
            operation.acked     = false;
            operation.ts  = process.hrtime()
            source.unshift( Request(operation) )
            
            function timeout(){
                if(operation.acked === false ){
                    delete queue[operation.sequence]
                    isReady = true
                    self.emit('error', new Error( 'Ack timeout id: ' + id + '. Check CRC or fibre connection.'))
                }
            }
            setTimeout(timeout,1000)
             
            self.emit('request', operation )
            if(id===0){
                self.emit('payload.start', 512 )
            }
    }
    function set_endpoint(id,payload,callback){
        var operation         = new packet()
            operation.id      = id - 0
            operation.size    = payload.length - 0
            operation.payload = Buffer.from( payload )
            operation.request = 'set'
            operation.callback = callback
            operation.acked
            operation.ts  = process.hrtime()
            source.unshift( Request(operation))
            
            function timeout(){
                if(operation.acked === false ){
                    delete queue[operation.sequence]
                    isReady = true
                    self.emit('error', new Error( 'Ack timeout id: ' + id + '. Check CRC or fibre connection.'))
                }
            }
            setTimeout(timeout,1000)
            
            self.emit('request', operation )
    }
        self.on('connect',  connect)
        self.get = get_endpoint
        self.set = set_endpoint
    return self
}
module.exports = fibre 
