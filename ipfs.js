`use strict`

const fileSys = require('fs-extra');
const path = require('path');
const Yaml = require('js-yaml');
const logs = require('./log');
const { sep } = require('path');
const IpfsHttpClient = require('ipfs-http-client');
const { globSource } = IpfsHttpClient;
const Hash = require('ipfs-only-hash');

// Pull in configuration options - setup.yml
let config;
try {
  config = Yaml.load(fileSys.readFileSync('setup.yml'))
} catch (error) {
    //Dies hard this way.. This is a major issue we just fail outright on
    console.log(`Error in log.js: ${error}`)
    process.exit(-1);
}

// Catch and display the errors nicely
function CatchError(err) {
    if (typeof err === 'object') {
      if (err.message) {
        logs.error(err.message)
      }
      if (err.stack) {
        logs.error('StackTrace:')
        logs.error(err.stack);
      }
    } else {
      logs.error('error in CatchError:: argument is not an object');
    }
    console.log("---exiting---")
    process.exit()
}


// Vars
let ipfsClient = 0;
let IPNSAddress;
module.exports.getIPNSAddress = function(){
  return IPNSAddress;
}


// Establish a connection to our local instance of IPFS API
const Connect = async function () {
    try {
        // Connect to the local instance of IPFS
        let connectionString = `http://${config.ipfsnode.apiHost}:${config.ipfsnode.apiPort}`;
        ipfsClient = IpfsHttpClient(connectionString, {timeout: config.ipfsnode.timeout});
        let configInfo = await ipfsClient.getEndpointConfig();
        logs.info(`ipfs http client connected: ${JSON.stringify(configInfo, null, 2)}`)

        // Ensure we have a IPNS key assigned
        let ipnsKeyName = config.ipfsnode.ipnsKey;
        logs.info(`validating IPNS key exists: ${ipnsKeyName}`)
        const ipfsKeyList = await ipfsClient.key.list();
        let locateKey = ipfsKeyList.find(o => o.name === ipnsKeyName);

        // If we cannot find a key, create a new one
        if (!locateKey) {
            logs.warn(`unable to find ipns key: '${ipnsKeyName}', attempting to generate new key`)
            // - generate IPNS key, move these options to config file later
            let genIPFSKey = await ipfsClient.key.gen(ipnsKeyName, { type: 'rsa', size: 2048 })
            logs.info(`generated IPNS key data: ${JSON.stringify(genIPFSKey, null, 2)}`)
        } else {
          logs.info(`located IPNS Key: '${locateKey.name}',  IPNS: 'ipns://${locateKey.id}/'`)
          IPNSAddress = locateKey.id
        }

    } catch (error) {
        CatchError(error)
    }
}
Connect()


// Fetch files cids, returns cids for files
async function GetFileHashes(contentDirectory) {
    try {
        logs.info(`gathering IPFS CID`)
        //options specific to globSource
        const globSourceOptions = { recursive: true };
        
        let cids = {};
        for await (let value of globSource(contentDirectory, globSourceOptions)) {
          if (value.content && value.path != `${path.sep}${config.indexer.filePath}${path.sep}meta.json`) {
            let fileData = await fileSys.readFileSync(value.content.path);
            const cid = await Hash.of(fileData);
            //Reformat the path name
            let newPathName = value.path.replace(`${path.sep}${config.indexer.filePath}`, "")
            cids[newPathName] = cid;
            logs.info(`adding '${value.path}' with cid ${cid} to meta data...`)
          }
        }
        return cids
    } catch (error) {
        CatchError(error)
    }
}
module.exports.GetFileHashes = GetFileHashes;


// Publish content to IPNS
const publishDir = async function(dirPath) {
    try {
        // Sanity check the dir
        if (!fileSys.existsSync(dirPath)) {
            logs.warn(`cannot publish IPNS data, ${dirPath} does not exist...`)
            return
        }

        // Sanity check the client
        if (!ipfsClient === 0) {
            logs.warn(`cannot publish IPNS data, client is not yet init...`)
            return
        }

        // Add the dirPath recursively to IPNS
        logs.info(`attempting to publish '${dirPath}' to IPNS`)
        const fileData = await ipfsClient.add(globSource(dirPath, { recursive: true }))
        logs.info(`ipfs information gathered for publishing to IPNS, CID:${fileData.cid}, Size:${fileData.size}, Path:${fileData.path}`)

        // Publish Options
        const options = {
            resolve: false,
            lifetime: config.ipfsnode.ipnsLifetime,
            ttl: config.ipfsnode.ipnsTTL,
            key: config.ipfsnode.ipnsKey,
            allowOffline: false
          }

        // Push to IPNS (this can take up to a minute plus to accomplish, longer to propigate)
        const publish = await ipfsClient.name.publish(fileData.cid, options)
        logs.info(`data published to IPNS: ipns://${publish.name}  IPFS: ${publish.value}`)

        return
    } catch (error) {
        CatchError(error)
    }
}
module.exports.publishDir = publishDir;


// Look over pins stored on system, remove old pins
const cleanPins = async function(keepPins) {
  try {
    logs.info('attempting to clean pin list')

    //Add Save Pins (if exists)
    if (config.ipfsnode.ignorePins){
      keepPins = keepPins.concat(config.ipfsnode.ignorePins)
    }

    // Get list of pins to remove, then remove
    for await (const pin of ipfsClient.pin.ls()) {
      let cidValue = `${pin.cid}`
      if (!keepPins.includes(cidValue) || pin.type === "indirect"){
        logs.debug(`attempting to unpin : ${cidValue}`)
        ipfsClient.pin.rmAll(pin.cid)
      }
    }

  } catch (error) {
    CatchError(error)
  }
}
module.exports.cleanPins = cleanPins;
