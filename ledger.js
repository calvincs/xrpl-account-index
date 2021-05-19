`use strict`

// Deal with this...
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const fileSys = require('fs-extra');
const path = require('path');
const Yaml = require('js-yaml');
const WebSocket = require('ws');
const logs = require('./log');
const { sep } = require('path');
const events = require('events');


// Pull in configuration options - setup.yml
let config;
try {
  config = Yaml.load(fileSys.readFileSync('setup.yml'))
} catch (error) {
    //Dies hard this way.. This is a major issue we just fail outright on
    console.log(`Error in log.js: ${error}`)
    process.exit(-1)
}

// Catch and display the errors nicely
function CatchError(err) {
    if (typeof err === 'object') {
      if (err.message) {
        logs.error(err.message)
      }
      if (err.stack) {
        logs.error('StackTrace:')
        logs.error(err.stack)
      }
    } else {
      logs.error('error in CatchError:: argument is not an object')
    }
    console.log("---exiting---")
    process.exit()
  }

// Are we connected?
let Connected = 0
module.exports.isLedgerConnected = function(){
    return Connected
}

// Ledger value? (pulled every X seconds)
let LedgerIndex = 0
module.exports.getLedgerIndex = function(){
    return LedgerIndex
}

// Ledger State bucket
let LedgerStateBucket = {}

// Make connection
const ENDPOINT = `wss://${config.rippled.host}:${config.rippled.port}`
logs.info(`connecting to rippled: ${ENDPOINT}`)
const WebService = new WebSocket(ENDPOINT)

// Emitt event on ledger processing completion
// - Make into class w/ features
const Events = new events.EventEmitter()
module.exports.Events = Events

// Message Router
WebService.on('message', function incoming (data) {
    try {
        const response = JSON.parse(data)
        //Sanity check
        if (response.status == "success" && response.type == "response") {
            switch(response.id || "error"){
                // id => closed  [ ProcessClosedLedgerStats(response) ]
                case "closed":
                    ProcessClosedLedgerStats(response)
                    break
                // id => state [ ProcessLedgerStateData(response) ]
                case "state":
                    ProcessLedgerStateData(response)
                    break
                // catch all
                default:
                    logs.warn(`Unknown message recv: ${JSON.stringify(response, null, 2)}`)
                    break
            }
        } else {
            logs.warn(`Bad message recv: ${JSON.stringify(response, null, 2)}`)
        }
    } catch (error) {
     CatchError(error)   
    }
})

// When WS OPEN
WebService.on('open', function open () {
    try {
        logs.info('websocket is connected')
        Connected = 1
        logs.info('fetching latest ledger index value')
        GetLatestClosedLegder()
        // -- Start up, get latest ledger...
        FetchLedgerStats()
    } catch (error) {
        CatchError(error)
    }
})

// When WS Close
WebService.on('close', function open () {
    try {
        logs.info('websocket is closed')
        Connected = 0
    } catch (error) {
        CatchError(error)
    }
})

// When WS connection fails
WebService.on('connectFailed', function open() {
    try {
        logs.warn(`websocket failed to connect to endpoint: ${ENDPOINT}`)
        Connected = 0 // Not req, but why not
    } catch (error) {
        CatchError(error)
    }
})

// Get latest closed ledger information
const GetLatestClosedLegder = function() {
    try {
        WebService.send(JSON.stringify({ command: "ledger", ledger_index: "closed", id: "closed"}))
    } catch (error) {
        CatchError(error)
    }
}
module.exports.GetLatestClosedLegder = GetLatestClosedLegder

// Process the closed ledger stats from GetLastestClosedLedger
const ProcessClosedLedgerStats = function(response) {
    try {
        let data = response.result
        LedgerIndex = data.ledger_index
        logs.info(`[ClosedLedgerStats] -> Index: ${data.ledger_index} Validated: ${data.validated} Close time: ${data.ledger.close_time_human}`)
    } catch (error) {
        CatchError(error)
    }
}

// Build out stats on Account State for a given ledger Index
// - Primarily looking at: Domain field for service discovery
const ProcessLedgerStateData = function(response) {
    try {
        let foundData = false
        let data = response.result
        let index = data.ledger_index
        // Ensure index is in LedgerStateBucket
        if (!LedgerStateBucket.hasOwnProperty(index)) {
            // Ensure ledger has been closed before processing it, must be valid
            if (!response.result.ledger.closed) {
                // If ledger is not yet closed, reject this ledger and pick a new one -1
                logs.warn(`skipping ledger index ${index}, as its not yet closed...`)
                FetchLedgerStats(index=index-1)
                return
            }
            logs.debug(`Adding Ledger state index to LedgerStateBucket`)
            LedgerStateBucket[index] = {"header" : response.result.ledger, "objects": [] }
        }
        if (data.state) {
            //Process the data results
            data.state.forEach((i) => {
              if (i.Domain){
                let tmpObj = {}
                tmpObj.a = i.Account //Can build out more later
                if (i.Domain) {tmpObj.d = i.Domain}
                LedgerStateBucket[index].objects.push(tmpObj)
                foundData = true
              }
            })
            // Do we have more data to collect?
            if (data.marker) {
                FetchLedgerStats(index=index, marker=data.marker)
                if (foundData) {
                    logs.debug(`Gathering more data for ${index}, current size in collection ${LedgerStateBucket[index].objects.length}`)
                }
            } else {
                logs.info(`size in ${index} collection ${LedgerStateBucket[index].objects.length}`)
                logs.info("No more data to collect from rippled server, processing data")
                CreateLedgerIndexFiles(index)
            }
        }
    } catch (error) {

        CatchError(error)
    }
}

// Make a call(s) to rippled for data
const FetchLedgerStats = function(index,marker) {
    try {
        let ledgerIndex = index || null
        let request = {id: "state", command: "ledger_data", ledger_index: ledgerIndex, limit: 200000, binary: false}
        let markPos = marker || null
        if (markPos) {
            request.marker = markPos
        }
        WebService.send(JSON.stringify(request))
    } catch (error) {
        CatchError(error)
    }
}
module.exports.FetchLedgerStats = FetchLedgerStats


// Process data into json files stored in the folder corr. to its index
const CreateLedgerIndexFiles = async function(index) {
    /*
        :: Service Discovery ::
        ipfs        :  697066733A               // IPFS Addr
        ilp         :  696C703A                 // ILP Addr
        http        :  687474703A               // HTTPS Addr
        bith        :  626974683A               // Torren Addr
        ftp         :  6674703A                 // FTP Addr
        callto      :  63616C6C746F3A           // Phone Addr
        mailto      :  6D61696C746F3A           // Email Addr
        pay         :  7061793A                 // Pay String Addr
        paystring   :  706179737472696E673A     // Pay String Addr
        wss         :  5753533A         // Secure Web Socket
        ws          :  57533A           // Web Socket
        @xnft       :  40786E66743A     // XRP based NFT Objects
        @xdns       :  4078646E733A     // XRP Name Resolution Object / Services
        @xndxr      :  40786E6478723A   // Indexer Oject / Services (Find othe
                    return
        @xmplc      :  40786D706C633A   // @CloudXmpl Xmpl.Cloud Object / Services
        @xrp-ledger-tom :  407872702D6C65646765722D746F6D3A  // XRP Ledger TOML Object         
    */
    try {
        const services = {
            // ** Protos Addrs **
            "bith"   : "626974683A",
            "callto" : "63616C6C746F3A",
            "ftp"    : "6674703A",
            "http"   : "687474703A",
            "ilp"    : "696C703A",
            "ipfs"   : "697066733A",
            "mailto" : "6D61696C746F3A",
            "pay"    : "7061793A",
            "paystring" : "706179737472696E673A",
            "ws"        : "57533A",
            "wss"       : "5753533A",
            // ** Services Objects ** 
            "data"  : "40646174613A",
            "xapp"  :  "40786170703A",
            "xdns"  :  "4078646E733A",
            "xmplc" :  "40786D706C633A",
            "xndxr" :  "40786E6478723A",
            "xnft"  :  "40786E66743A",
            "xrp-ledger-tom" :"407872702D6C65646765722D746F6D3A",
            "xumm"  :  "4078756D6D3A",
            // ** Catch All **
            "debug" :  "6465627567"
        }

        //Process the data results, put them in their respective buckets
        let output = {};

        LedgerStateBucket[index].objects.forEach((o) => {
            let matched = false;
            Object.entries(services).forEach(entry => {
                const [key, value] = entry;
                if (o.d.startsWith(value)) {
                    matched = true
                    //console.log(`${key}: Account: ${o.a}, Domain: ${Buffer.from(o.d, 'hex').toString()}`)
                    // Put in a bucket
                    if (output.hasOwnProperty(value)) {
                        output[value].push({[o.a] : o.d})
                    } else {
                        output[value] = [];
                        output[value].push({[o.a] : o.d})
                    }
                    return
                }
            });
            
            // Put in debug collection
            if (!matched) {
                if (output.hasOwnProperty("6465627567")) {
                    output["6465627567"].push({[o.a] : o.d})
                } else {
                    output["6465627567"] = [];
                    output["6465627567"].push({[o.a] : o.d})
                }
                return
            }
        })

        //Ensure records path exists, else create it
        let filePath = config.indexer.filePath + path.sep + `${index}` + path.sep
        !fileSys.existsSync(filePath) && fileSys.mkdirSync(filePath)
        logs.info(`created records destination: '${filePath}'`)

        //Write data to files
        Object.entries(output).forEach(async (entry) => {
            const [indexKey, values] = entry;
            let tmp = {}
            tmp.index = index
            tmp.records = values
            tmp.prefix = indexKey

            //Give file a human readable name
            let fileType;
            Object.entries(services).forEach(entry => {
                const [key, value] = entry
                if (value == indexKey) {
                    fileType = key;
                    return
                }
            })

            let fileName = filePath +`${fileType}.json`
            logs.info(`index ${index} writting ${fileName}`)
            await fileSys.writeFile(fileName, JSON.stringify(tmp))
            // This provides an easy path for known objects being called via a HTTP or IPNS endpoint for existing issues.
            // - More details are provided in the meta.json file however, including IPFS and IPNS paths
            if (config.indexer.rootCopy) {
                logs.info(`detected rootCopy was set true, copying ${fileName} to root directory of ${config.indexer.filePath}`)
                let copyFilePath = config.indexer.filePath + path.sep + `${fileType}.json`
                await fileSys.copy(fileName, copyFilePath, {preserveTimestamps: true, overwrite: true})
            }
        });

        //Write the base header.js file for the index
        logs.info(`writing the header.json file for ${index} folder`)
        let fileName = filePath +'header.json'
        let header = LedgerStateBucket[index].header
        await fileSys.writeFile(fileName, JSON.stringify(header, null, 2))

        //Remove the index from the list
        logs.debug(`removing ${index} from LedgerStateBucket`)
        delete LedgerStateBucket[index]

        //Fire event, we are ready to process ledger index data
        Events.emit('processedIndex', index, header)

    } catch (error) {
        CatchError(error)
    } 
}


// Regularly check ledger index value, update ledgerIndex value
let CheckLedgerIndex = setInterval(async () => {
    try {
        if (Connected) { GetLatestClosedLegder() }
    } catch (error) {
        CatchError(error)
    }
}, config.indexer.freqIndexCheck) //Will check every X milli seconds