
# Implementation
## Introduction

The Activity Schema [specification](2.0.md) describes the *structure* of an activity schema, but does not cover the *implementation* of an activity schema on a warehouse. 

This document discusses some best practices when building an Activity Schema in production, informed by Narrator's experience building and evolving an Activity Schema data model

### Implementation Stages

An activity schema approach differs from dimensional modeling in how it is created, maintained, and queried. Most implementations will provide support for all of these cases. 

For the purposes of this doc they're split up into three stages: **Table Structure**, **Processing**, and **Querying**.

<br>

## Table Structure

The basic table structure obviously should have the columns specified in the [spec](2.0.md#activity-stream). But it's also helpful to add a couple computed columns. 

### Occurrence Columns

It's very common to query the 1st, 2nd, last, etc activity done by a customer. To make these more efficient it can be helpful to add **activity_occurrence** and **activity_repeated_at** columns. Nneither are part of the spec, but are useful to have. 

**activity_occurrence** represents the number of times a given entity has done that activity, at the time that activity occurred (starting with 1). **activity_repeated_at** is a timestamp of the next time the activity is repeated. Both can be computed directly from the activity stream as window functions


```sql
 row_number() over (partition by coalesce (activity, customer, anonymous_customer_id) order by ts asc) as activity_occurrence,
 lead(ts) over (partition by coalesce (activity, customer, anonymous_customer_id) order by ts asc) as activity_repeated_at
```


<br>


### Single vs Multiple stream tables

Generally it's recommended to use a single activity stream table for all activities. It makes querying and debugging a lot simpler. For instance, following a specific customer journey is far easier with a single stream.

Creating a single table per stream can help with performance, but it won't matter much if a stream is below 50M rows. Beyond that, it can be helpful to split, but is worth testing. Extremely large activity streams, particularly on BigQuery, will benefit from being partitioned into several stream tables. 

<br>


### Partioning / Clustering

Most of the complexity is around how to sort / partition for best query performance. In general queries to an activity schema will filter or group by activity and time, so it's best to align around those.

<br>

### Redshift

**Table Type**|**diststyle**|**sortkey**
-----|-----|-----|
Single table for all activities|EVEN|"activity", "ts", "activity_occurrence"
One table per activity|EVEN|"ts", "activity_occurrence"

<br>

### BigQuery

For BigQuery it's highly recommended to run one table per activity instead of a single activity stream table. This is because BigQuery can't partition by both activity and time. 


**Table Type**|**clusterkey**|**partition_column**
-----|-----|-----|
Single table for all activities|activity, activity_occurrence, customer|TIMESTAMP_TRUNC(ts, MONTH)
One table per activity|activity_occurrence, customer|TIMESTAMP_TRUNC(ts, MONTH)

<br>

### Snowflake

**Table Type**|**cluster_column**
-----|-----|
Single table for all activities|activity, activity_occurrence in (1, NULL), activity_repeated_at is NULL, to_date(ts)
One table per activity|activity_occurrence in (1, NULL), activity_repeated_at is NULL, to_date(ts)

<br>

### Postgres

Postgres is a bit of a special case but can be used as a warehouse. For implementation instructions this [blog](https://www.narratordata.com/blog/using-postgresql-as-a-data-warehouse/) goes in-depth

<br>

### Databricks

**Table Type**|**partition_by**|**cluster_by**
-----|-----|-----|
Single table for all activities|activity, DATE(ts)|TIMESTAMP_TRUNC(ts, MONTH)
One table per activity|DATE(ts)|TIMESTAMP_TRUNC(ts, MONTH)

<br>

### Athena

**Table Type**|**partitioned_by**
-----|-----|
Single table for all activities|activity VARCHAR(255), activity_occurrence INT, DATE(ts) DATE
One table per activity|activity_occurrence INT, DATE(ts) DATE

<br>
<br>



## Tools for Processing

Maintaining an activity schema implementation requires these steps

- periodically run transformation SQL queries and insert the results into the activity stream table(s)
- on updates to the activity stream fill in the **activity_occurrence** and **activity_repeated_at** columns
- if **anonymous_customer_id** is used, periodically scan the activity stream and fill in **customer** for the **anonymous_customer_id** that has been identified.

Any tool designed to run queries on a schedule can build and maintain a simple activity stream table. For now there are few open-source utilities to help do this, but we'll add them as they become available.

<br>

### dbt

dbt is built for processing data on a schedule and can be used to create and maintain an activity stream. 

The [activity_schema](https://hub.getdbt.com/narratorai/activity_schema/latest/) package on dbt hub has some helper macros to build a feature_json column and fill in the activity occurrence column. 

When building an activity stream table with dbt it's strongly encouraged to materialize it as a table, rather than a view. 

We don't yet have enough first-hand experience with maintaining an activity stream in dbt to provide specific advice on more advanced topics like incremental materialization.

<br>

### BigQuery Scheduled Queries

Scheduled queries in BigQuery should be able to manage an activity stream table fairly well. We don't have any specific examples or guidance yet but will add it here when we do.

<br>

### Narrator

[Narrator](https://www.narratordata.com) is the only (currently) known commercial project to maintain an Activity Schema data model. It's designed to provide very sophisticated processing of an activity stream, particularly for large data.

It provides

1. Support for a single stream or one stream per activity
2. Incremental updates
3. Nightly reconcilation: insert any rows that were missed during incremental updates due to arriving late to the source tables
4. Weekly historical data checks: Randomly samples source data tables to check for new records with old timestamps that might have been missed
5. Window deletes: Support for deleting a specific time window of data and reinserting it on each update
6. Identity resolution: Mapping and updating the `anonymous_customer_id` to `customer` over time: multi-user, multi-device, with the ability to change the user mapping historically
7. Aliasing customers: Allows remapping a `customer` to a new `customer` -- e.g. if someone changes their email address
8. Remove list: maintain a list of customers whose activities will not be inserted into the stream
9. Many-to-many SQL to activities: one transformation can create multiple activities and one activity can be created from several transformations

<br>

## General Processing Guidance

### Incremental Updates

The Activity Schema was designed around incremental updaets. For large data this saves a significant amount of time and cost and is the preferred way to manage an activity stream in production.

In theory incremental updates are straightforward. Each activity in an Activity Schema data model is immutable, so appending data to the stream tables should be sufficient to keep the activity stream in good shape.

In practice data is messy and this can get extremely hard. A few things to watch out for:

<br>

**Duplicate Timestamps**

Activities, as written, may not always fully immutable -- a frequent issue in practice is writing activity transformations where the `ts` value can be updated. 

For example, if a 'Closed Account' activity might be built on a source table that isn't immutable -- say the 'accounts' table with a `closed_at` timestamp. If the account is reopened, then closed again, the `closed_at` timestamp will change. A fully incremental processing approach will insert a new record into the stream -- leading to potentially duplicate activity ids. 

It's outside the scope of this document to discuss how to model data to avoid this. In practice, with real data, it's not always practical to do so, so an incremental processing approach will have to know how to detect and rebuild activities that have this issue.

<br>

**Late inserts**

Incremental processing generally maintains a time window for inserts -- say the time since the last successful insert and now. If new row appears with a timestamp older than the time window, it won't get processed. An incremental approach will have to look back and find those late rows. 


<br>

## Querying

An activity stream lives in a warehouse and is queried with SQL, just like other tables. That said, writing SQL by hand for an activity schema is challenging, and traditional joins using foreign keys aren't the best way to express queries.

Activity schemas are fundamentally built around a customer doing something in time. The best way to combine activities is time-based joins, which we call **relationships**. They are discussed in the [spec](2.0.md#relationships). The idea is that each of these concepts is sufficient to combine any activities in any way needed for analysis. Relationship-based querying is the approach that Narrator has taken over several years, and so far has worked to build any table needed for BI. 

Implementing relationships means providing a way for the user to express their query in terms of relationships, and from there generating the SQL to query the stream directly. Narrator provides a UI to express the activity relationships: "for all 'web_session' activities append the first in between 'submitted lead'". From there it issues a warehouse-specific query in SQL to return the result set.

Currently there is no open-source example for how to do this, but we expect to add in more resources over time. 

<br>

### First and Last

One of the most useful queries in an activity schema is the **First** or **Last** instance of an activity per customer.

For example, new visitors to the website is done by querying the **visited_website** activity and filtering by the **first** activity occurrence

```sql
SELECT
	*
FROM customer_stream AS c
where c.activity = 'visited_website'
	and c.activity_occurrence = 1
```


Looking up every customer's current subsription is done by querying the **last** **updated_subscription** activity. 

```sql
SELECT
	*
FROM company_stream AS c
where c.activity = 'updated_subscription'
	and c.activity_repeated_at is NULL
```

Since these two expressions each return only one row per customer, they're also a very efficient way to get every unique customer that has done an activity. 

