# super-bot-slack

This is a Slack client for [super-bot](https://github.com/gfaraj/super-bot). It is built using [Botkit](https://www.npmjs.com/package/botkit) version 0.7.0. It's not using the latest version of Botkit (v4 at the time of this writing) because it doesn't support the RTM API, and this is needed if you can't expose a public endpoint for Slack to push new messages. Currently, the Slack client only supports text messages. This client supports attachments of any kind (images, files, etc.) and will also work with message threads.
