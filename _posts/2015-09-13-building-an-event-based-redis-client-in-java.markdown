---
layout: post
title: "Building an Event-based Redis Client in Java"
date: 2015-09-13T13:35:21+01:00
description: ""
category: "blog"
---

## The story so far ##

(You may want to skip this part, if you have already read my previous blog post on the subject: [Java in a polyglot JVM world](/blog/2015/06/02/java-in-a-polygot-jvm-world))

A few months ago, I had an idea for a project that required a certain amount of data-processing.  Nothing very sophisticated, but potentially very time consuming.  As with a lot of projects, there were a wealth of open-source libraries that would get me 95% of the way; these could be integrated into a pipeline based on Clojure's `core.async`.  However one thing was missing: state, each process (there may have been more than one) would need to know what work remained; if this state were lost, everything would have to begin from scratch.

As things happened, I quickly realised the scope was much smaller than I had reckoned, so I quickly reached my goal with a single Ruby script and a SQLite database.  But the seed had been sewn, I wanted a way of talking to Redis is a non-blocking way, so it could be integrated with Clojure's `core.async`.  That quickly became the [`redis-async` project](https://github.com/benashford/redis-async).

However, the initial performance of this project was poor.  Poor enough, compared to pre-existing non-async Redis clients that it nullified the existence of the project, no-one (not even me) would use it in that state.  So I began to investigate the poor performance, and fix things.  This gave birth to the [JRESP project](https://github.com/benashford/jresp).  The process and rationale of this changes I described in the earlier blog post: [Java in a polyglot JVM world](/blog/2015/06/02/java-in-a-polygot-jvm-world).

This led to much improved performance for `redis-async`, with most of the high-level code in Clojure but the low-level code (serialisation, sockets, etc.) in Java.

But there was still more to do...

Performance was still an order of magnitude poorer than the competition.  I had many theories for this, mostly revolving around two themes: 1) the more complex nature of parsing results in an event-based system, you can't just read bytes from an `InputStream`; and, 2) the complex handling of multiplexing many Redis commands onto a single connection with implicit pipelining.

This gave me two avenues to explore to make things better.

## Why pipelining? ##

To make the most efficient use of the connection.  Each Redis command is (typically, there are some exceptions) small; rather than waiting for a response for each command, it is more efficient to send multiple commands, then wait for all of the corresponding responses.  The official Redis docs have a [good explanation of this, and benchmarks](http://redis.io/topics/pipelining).

Most traditional clients make pipelining the responsibility of the application developer.  Typically by declaring a block that contains multiple Redis commands, the block then returns a single collection containing all of the results[^1].

The advantage of an asynchronous and/or event-based approach is that pipelining can be achieved done automatically[^2].  If an application is issuing ten commands in quick succession, since it doesn't wait for responses immediately these can all be combined into a single request/response cycle.  This should make the application code cleaner, and also, potentially, discover additional efficiencies if there are multiple threads issuing commands at the same time, they could all be combined into one single request/response cycle.

The downside is that none of this can be guaranteed, since the code cannot know when these breaks are.  Instead it relies on the principal that issuing commands will be faster than writing to a socket, so each socket write will be fully utilised in the sense that all commands issued in the interim will be included.  But there will undoubtedly be some edge-cases where the worst-case occurs.

As with most different approaches to common problems, there are tradeoffs, and there is an upside to the non-determinism.  In the case of very-large numbers of commands in a single pipeline (hundreds of thousands), there is a latency problem in existing synchronous clients - the first command won't be actually sent until all the commands have been issued, and the first response won't be parsed until all commands have been sent - but with implicit pipelining the stream will be naturally batched into smaller chunks, something that would have to be done manually using other approaches.

The goal, therefore, is that using JRESP and `redis-async` in a naive way will be more efficient than using existing synchronous clients in a naive way, even if you use pipelining.

## Implicit pipelining ##

The way `redis-async` implemented implicit pipelining was at the `core.async` layer.  Essentially whenever an outgoing command went through the outgoing (buffered) channel, before sending it to Redis (via JRESP) any other commands on the channel were also taken (but it wouldn't wait for any more), these would be read into a vector which would be passed to JRESP.  This still had the latency problem if there was a large number of commands.

The most recent change has been to move this responsibility out of the Clojure layer and into the Java layer.  This has resulted in two key benefits: 1) a great simplification of the Clojure code, there's no need for an outgoing channel anymore, each Redis command is a thin wrapper calling the underling JRESP `write` method; and, 2) it means the implicit pipelining can be done in sync with the low-level socket signalling using Java's NIO package.

Now, when a command is issued from `redis-async` this corresponds with a single method call to JRESP.  The command will be serialised into a `java.nio.ByteBuffer` and added to a queue.  The queue compacts multiple byte buffers up to a maximum size - essentially the size of one TCP packet.  Each connection pool (a new addition to JRESP) has a thread dedicated to all the sockets it controls, this uses a `java.nio.channels.Selector` and the state of each queue to be notified when each socket is ready for reading or writing.

## Conclusion ##

This new approach has resulted in a significant gain in throughput compared to previously.  I'm planning on doing a comprehensive set of performance tests, but so far been using the same micro-benchmarks I mentioned in the previous post.  On those measures `redis-async` performance is between 10% faster and 100% slower than Carmine; although, interestingly, JRESP alone seems to be 25% faster than Jedis.  These numbers feel counter intuitive somehow, as either Carmine is faster than Jedis, which other benchmarks show not to be the case, or this heavily implies the difference in performance is due to the Clojure layer of `redis-async` above JRESP[^3]... but I need to investigate more to both prove these interim results and to provide enough test cases to improve things further, the micro-benchmarks are too unrealistic to draw conclusions.

But, what is significant is the progress of improving performance as I've gone though these refinements.  From one hundred times slower to more-or-less[^4] the same speed.

The final question, what's to stop JRESP being a full-blown Redis client in its own right?  Not a lot actually, it now has all of the requisite parts, but it's not a particular priority given the wealth of alternative Java clients.  But all that is needed is a facade class containing methods for each Redis command, in `redis-async` this is automatically generated from the [list of commands provided by redis-doc](https://github.com/antirez/redis-doc/blob/master/commands.json); obviously the meta-programming nature of Clojure makes this easy, I'll need to find use an external tool to do the same with JRESP.

### Footnotes ###

[^1]: The previous link to the Redis docs also contain code showing this in effect.

[^2]: `redis-async`'s README shows proof and examples of this: [https://github.com/benashford/redis-async#implicit-pipelining](https://github.com/benashford/redis-async#implicit-pipelining)

[^3]: My immediate guess is that `redis-async` is slower at issuing the commands; but JRESP will be sending data to Redis at the same speed.  The end result being less efficient throughput.

[^4]: Within one order-of-magnitude.