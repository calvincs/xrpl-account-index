`use strict`

const fileSys = require('fs-extra');
const path = require('path');
const Yaml = require('js-yaml');
const logs = require('./log');
const { sep } = require('path');
const Ledger = require('./ledger');
const IPFS = require('./ipfs');
const findRemoveSync = require('find-remove');


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


// Execute the main block, where all the cool stuff happens, kinda.. 
async function main() {
    try {
        // Regularly get a ledger data for publishing
        let GetLedgerIndexData = setInterval(() => {
            try {
                if (Ledger.isLedgerConnected) {
                    // Request a ledger index thats likely already validated
                    logs.info(`quering for latest ledger index for processing`)
                    Ledger.GetLatestClosedLegder()
                    let ledgerIndex = Ledger.getLedgerIndex()-1

                    // Start gather index data for processing
                    logs.info(`sending request to gather data for index ${ledgerIndex}`)
                    Ledger.FetchLedgerStats(ledgerIndex)

                } else {
                    logs.warn(`System is not currently connected to the ledger for index creation...`)
                }
            } catch (error) {
                CatchError(error)
            }
        }, config.indexer.createIndex) //Will check every X milli seconds

        // Wait for completed index creations
        Ledger.Events.on('processedIndex', async function (index, header) {
            // Records Dir
            let recordsDir = __dirname + path.sep + config.indexer.filePath + path.sep

            //Clean up the records directory
            let removeInSeconds = config.indexer.removeIndexes
            var cleaned = findRemoveSync(recordsDir, {age: {seconds: removeInSeconds},dir: '*'})
            for (let value of Object.keys(cleaned)) {
                logs.info(`removed aged directory: ${value}`)
            }

            // Package records for publishing
            logs.info(`packaging records for IPNS publishing`)

            // Temp MetaData object
            let metadata = {}
            metadata.current = {}

            // Attach header information (ledger state)
            metadata.current.ledger = header

            // Make entry for latest data for easy ref
            let ipnsAddr = IPFS.getIPNSAddress()
            let croot = `/ipns/${ipnsAddr}/${index}/`
            metadata.current.root = croot
            
            // Get files in index dir
            let cfiles = await fileSys.readdir(recordsDir + index)
            metadata.current.ipns = {}
            for (let value of Object.values(cfiles)) {
                let trimmed = value.replace(".json", "")
                metadata.current.ipns[trimmed] = croot + value
            }
             
            // Gather data for each of the index folders
            let data = await IPFS.GetFileHashes(recordsDir)

            // Parse an easily locatable path that does not require IPNS resolution for user (faster)
            metadata.current.ipfs = {}
            metadata.historical = {}
            for (let [xpath, cid] of Object.entries(data)) {
                if (xpath.includes(index)){
                    // clean up the path for easy refrence
                    let tmp = xpath.replace(`/${index}/`, "").replace(".json", "")
                    metadata.current.ipfs[tmp] = `/ipfs/${cid}`
                } else {
                    metadata.historical[xpath] = cid
                }
            }

            // Write meta data to disk...
            let metaFile = recordsDir + 'meta.json';
            await fileSys.writeFile(metaFile, JSON.stringify(metadata, null, 2))

            // Publish the data to IPNS
            logs.info(`attempting to publishing data to IPNS: ${croot}`)
            IPFS.publishDir(recordsDir)
        })

    } catch (error) {
        CatchError(error)
    }
}

// Make it happen
main()

