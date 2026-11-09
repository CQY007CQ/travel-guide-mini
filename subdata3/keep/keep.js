// subdata3/keep —— 占位页（不参与任何导航）。
// 与 subdata2/keep 同构：subdata3 作为第三个数据分包槽位（pack-data.mjs 已支持 subdata/subdata2/subdata3）。
// 当数据包体积逼近单包 2048KB 上限时，pack-data 会自动把数据切成第 3 块写入本分包；
// 加这个占位页使 subdata3 成为合法分包，避免数据块被误计入主包。
Page({});
