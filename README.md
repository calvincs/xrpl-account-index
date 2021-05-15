# xrpl-account-index
Gather XRP Ledger account information, distribute it over P2P for easy access by non rippled clients.

Based off the following (Wallet Object Types and Resource Addressing)[https://github.com/XRPLF/XRPL-Standards/discussions/44]

## Information
This is very alpha, and is subject to change at any time.
If you plan to run this service, you will require a dedicated Rippled server and a local IPFS node.


Currently indexing Testnet every 10 minutes, publishing discovered data.
 - /ipns/k2k4r8jzuhjc31n1f37iyhj4ka4nggz8pace0ho5korctclj7aqt8jxu
 - https://cloudflare-ipfs.com/ipns/k2k4r8jzuhjc31n1f37iyhj4ka4nggz8pace0ho5korctclj7aqt8jxu
 - https://ipfs.io/ipns/k2k4r8jzuhjc31n1f37iyhj4ka4nggz8pace0ho5korctclj7aqt8jxu
 - https://gateway.pinata.cloud/ipns/k2k4r8jzuhjc31n1f37iyhj4ka4nggz8pace0ho5korctclj7aqt8jxu


 - BE VERY CAREFUL accessing indexed resources, as they may not be safe.

## Indexing

 The script is currently indexing the following data.  

Indexing the following:
```ruby
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
    @xndxr      :  40786E6478723A   // Indexer Oject / Services (Find other public indexers)
    @data       :  40646174613A     // Data blobs / strings
    @xumm       :  4078756D6D3A     // Xumm Object / Services
    @xapp       :  40786170703A     // Xapps Object / Services
    @xmplc      :  40786D706C633A   // @CloudXmpl Xmpl.Cloud Object / Services
    @xrp-ledger-tom :  407872702D6C65646765722D746F6D3A  // XRP Ledger TOML Object         
```

meta.json file is updated to reflect indexing status, and links to data sources of intrest.

all non matching entries are deposited into the debug file
```ruby
// ** Catch All **
"debug" :  "6465627567"
```


## Contact 
 - Check back for updates or reach out to me on Twitter if you have questions @calcs9