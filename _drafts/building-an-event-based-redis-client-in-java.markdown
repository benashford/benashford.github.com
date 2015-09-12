---
layout: post
title: "Building an Event-based Redis Client in Java"
description: ""
category: "blog"
---

## The story so far ##

A few months ago, I had an idea for a project that required a certain amount of data-processing.  Nothing very sophisticated, but potentially very time consuming.  As with a lot of projects, there were a wealth of open-source libraries that would get me 95% of the way; these could be integrated into a pipeline based on Clojure's `core.async`.  However one thing was missing: state, each process (there may have been more than one) would need to know what work remained; this state couldn't be lost if the process was restarted.

As things happened, I quickly realised the scope was much smaller than I had reckoned, so I eventually reached my goal with a single Ruby script and a SQLite database.  But the seed had been sewn, I wanted a way of talking to Redis is a non-blocking way, so it could be integrated with Clojure's `core.async`.  That quickly became the [`redis-async` project](https://github.com/benashford/redis-async).

However, the initial performance of this project was poor.  Poor enough, compared to pre-existing non-async Redis clients that it nullified the existance of the project, no-one (not even me) would use it in that state.  So I began to investigate the poor performance, and fix things.  This gave birth to the [JRESP project](https://github.com/benashford/jresp).  The process and rationale of this changes I described in an earlier blog post [Java in a polyglot JVM world](/blog/2015/06/02/java-in-a-polygot-jvm-world).

This led to much improved performance for `redis-async`, with most of the high-level code in Clojure but the low-level code (serialisation, sockets, etc.) in Java.

But there was stil more to do...

Performance was still an order of magnitude poorer than the competition.  I had many theories for this, mostly revolving around two themes: 1) the more complex nature of parsing results in an event-based system, you can't just read bytes from an `InputStream`; and, 2) the complex handling of multiplexing many Redis commands onto a single connection with implicit pipelining.

This gave me two avenues to explore to make things better.

## Why pipelining? ##

To make the most efficient use of the connection is the short answer.  Each Redis command is (typically, there are some exceptions) small; rather than waiting for a response for each command, it is more efficient to send multiple commands, then wait for all of the corresponding responses.  The offical Redis docs have a [good explanation of this, and benchmarks](http://redis.io/topics/pipelining).

Most traditional clients make pipelining the responsibility of the application developer.  Typically by declaring a block that contains multiple Redis commands, the block then returns a single collection containing all of the results.

The advantage of a asynchronous/event-based approach is that this pipelining can be done automatically.  If an application is issuing ten commands in quick succession, since it doesn't wait for responses immediately (it waits on the channel - using `redis-async` as an example - later) these can all be combined into a single request/response cycle.  This should make the application code cleaner, and potentially discover additional efficiencies if there are multiple threads issuing commands at the same time, they could all be combined into one single request/response cycle.

The downside is that none of this can be guarenteed, since the code cannot know when these breaks are.  Instead it relies on the principal that issuing commands will be faster than writing to a socket, so each socket write will be fully utilised in the sense that all commands issued in the interim will be included.  But there will undoubtedly be some edge-cases where the worst-case occurs.

As with most different approaches to common problems, there are tradeoffs, and there is an upside to the non-determinism.  In the case of very-large numbers of commands in a single pipeline (hundreds of thousands), there is a latency problem using the traditional approaches - the first command won't be actually sent until all the commands have been issued, and the first response won't be parsed until all commands have been sent - but with implicit pipelining the stream will be naturally batched into smaller chunks, something that would have to be done manually using other approaches.

## Implicit pipelining ##

The way `redis-async` implemented implicit pipelining was at the `core.async` layer.  Essentially whenever an outgoing command went through the outgoing (buffered) channel, before sending it to Redis (via JRESP) any other commands on the commands on the channel were also taken (but it wouldn't wait for any more).  This would still have the latency problem if there was a large number of commands.

The most recent change has been to move this responsibility out of the Clojure layer and into the Java layer.  This has resulted in two key benefits: 1) a great simiplification of the Clojure code, there's no need for an outgoing channel anymore; and, 2) it means the implicit pipelining can be done in sync with the low-level socket signalling availability for read/write operations.

Now, when a command is issued from `redis-async` this corresponds with a single method call to JRESP.  The command will be serialised into a `java.nio.ByteBuffer` and added to a queue.  The queue compacts multiple byte buffers up to a maximum size - essentially the size of one TCP packet.  Each connection pool (a new addition to JRESP) has a thread dedicated to all the sockets it controls, this uses a `java.nio.channels.Selector` and the state of each queue to be notified when each socket is ready for reading or writing.

## Conclusion ##

This new approach has resulted in a significant gain in throughput compared to previously.  I'm planning on doing a comprehensive set of performance tests, but so far been using the same micro-benchmarks I mentioned in the previous post.  On those measures `redis-async` performance is between 10% faster and 100% slower than Carmine; although, interestingly, JRESP alone seems to be 25% faster than Jedis.  These numbers feel counter intuitive somehow, but I need to investigate more to both prove these interim results and to provide enough test cases to improve things further, the micro-benchmarks are too unrealistic to draw conclusions.

But, what is significant is the progress of improving performance as I've gone though these refinements.  From one hundred times slower to more-or-less the same speed.

The final question, what's to stop JRESP being a full-blown Redis client in its own right?  Not a lot actually, it now has all of the requisite parts, but it's not a particular priority given the wealth of alternative Java clients.
