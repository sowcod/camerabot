/**
 * Responds to any HTTP request.
 *
 * @param {!Object} req HTTP request context.
 * @param {!Object} res HTTP response context.
 */
const crypto = require('crypto');
const request = require('request-promise');
const urljoin = require('url-join');
const keys = require('./keys.json');

const datastore = require('@google-cloud/datastore')()

const channel_secret = keys.channel_secret;
const channel_token = keys.channel_token;

const getUrlEntity = async () => {
  const query = datastore.createQuery('cameraBotWebhookUrl').limit(1);
  const results = await datastore.runQuery(query);
  if (results[0]) {
    return results[0][0];
  } else {
    return null;
  }
}

const updateUrl = async (url) => {
  const transaction = datastore.transaction();
  await transaction.run();
  let entity = await getUrlEntity();
  if (entity == null) {
    entity = {
      key: datastore.key('cameraBotWebhookUrl'),
      data: {
        url: url
      }
    };
  } else {
    entity.url = url;
  }
  await datastore.save(entity);
  await transaction.commit();
}

const deleteUrl = async () => {
  const transaction = datastore.transaction();
  await transaction.run();
  let entity = await getUrlEntity();
  await datastore.delete(entity[datastore.KEY]);
  await transaction.commit();
}

const reply = async (token) => {

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + channel_token
  };

  let imageUrlsObj;
  try {
    // リクエスト先のURLを取得する
    const entity = await getUrlEntity()
    const getUrl = entity.url

    // 画像のURLを取得する
    const getUrlOption = {
      url: getUrl,
      timeout: 100000
    };
    const imageUrls = await request.get(getUrlOption)
    imageUrlsObj = JSON.parse(imageUrls)
  } catch (e) {
    const body = {
      'replyToken': token,
      'messages': [{type: 'text', text: 'カメラサーバーが応答しません'}]
    };
    const options = {
      uri: 'https://api.line.me/v2/bot/message/reply',
      headers: headers,
      body: JSON.stringify(body)
    }
    return request.post(options)
      .then(() => {
      });
  }
  // {original, preview}
  
  /*
  let body = {
    'replyToken': token,
    'messages': [{type: 'text', text: 'こんにちは！'}]
  };
  */
  let body = {
    'replyToken': token,
    'messages': [{
      type: 'image',
      originalContentUrl: imageUrlsObj.original,
      previewImageUrl: imageUrlsObj.preview  
    }]
  };
  const options = {
    uri: 'https://api.line.me/v2/bot/message/reply',
    headers: headers,
    body: JSON.stringify(body)
  }
  return request.post(options)
    .then(() => {
      console.log(body);
    });
}

const recvTalk = (req, res) => {
  if (req.body.mode === 'set_webhook') {
    /*
    {
      mode: 'set_webhook',
      url: 'http://xxxx.com/', // 省略可能
      port: '8880', // 省略可能(urlがない場合は必須)
      path: '/get_image' // 省略可能(urlがない場合は必須)
    }
    */
    console.log('set_webhook' + JSON.stringify(req.body));
    let webhookUrl;
    if (req.body.url != null) {
      webhookUrl = req.body.url;
    } else {
      const ip = req.headers['x-forwarded-for'].split(',')[0].trim()/* || req.connection.remoteAddress*/;
      webhookUrl = urljoin('http://' + ip + ':' + req.body.port, req.body.path);
    }

    const testUrl = urljoin(webhookUrl, '/test')
    // test webhookUrl and save
    return request.get(testUrl)
      .then(() => updateUrl(webhookUrl))
      .then(() => res.status(200).send())
      .catch(err => {
        console.log(err);
        res.status(500).send(); 
      });
  } else if (req.body.mode === 'unset_webhook') {
    getUrlEntity()
      .then(entity => {
        console.log('delete webhook : ' + entity.url);
      });
    return deleteUrl()
      .then(() => {
        console.log('delete success');
        res.status(200).send();
      });
  }

  let hmac = crypto.createHmac('sha256', channel_secret);
  const signature = hmac.update(Buffer.from(JSON.stringify(req.body))).digest('base64');

  const recv_signature = req.header('X-Line-Signature')

  if (signature === recv_signature) {
    for (let eventObj of req.body.events) {
      if (eventObj.type === 'message') {
        return reply(eventObj.replyToken, res);
      }
    }
  }
  return res.status(200).send();
};

exports.talk = recvTalk;

